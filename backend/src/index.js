import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:4200',
  'http://127.0.0.1:4200',
].filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} no permitido por CORS`));
    }
  },
  methods: ['POST'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json());

const METRO_BBOX = {
  minLat: 10.80, maxLat: 11.10,
  minLon: -74.96, maxLon: -74.64,
};

function estaEnAreaMetropolitana(lat, lon) {
  return lat >= METRO_BBOX.minLat && lat <= METRO_BBOX.maxLat
      && lon >= METRO_BBOX.minLon && lon <= METRO_BBOX.maxLon;
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const toolDefinition = {
  functionDeclarations: [{
    name: 'consultarTraficoBarranquilla',
    description: 'Consulta el estado del tráfico en una dirección, barrio, intersección o zona específica de Barranquilla, Colombia. Convierte la dirección a coordenadas (geocoding) y obtiene el flujo de tráfico e incidentes actuales. Acepta formatos colombianos como "Carrera 46 #82-15", "Calle 84 con Cra 55", "Vía 40 con Calle 72", "Circunvalar con Cra 21", o lugares turísticos como "Gran Malecón", "Buenavista", "Centro Histórico".',
    parameters: {
      type: 'object',
      properties: {
        direccion_o_zona: {
          type: 'string',
          description: 'Dirección, barrio, intersección, centro comercial o punto de referencia en Barranquilla, Colombia. Acepta formatos colombianos: "Carrera 46 con Calle 82", "Cra 53 #74-25", "Vía 40", "Circunvalar con Cra 21", "Gran Malecón", "Buenavista", "Norte de Barranquilla"'
        }
      },
      required: ['direccion_o_zona']
    }
  }]
};

const SYSTEM_INSTRUCTION = `Eres "QuillaTraffic", un asistente experto en tráfico del área metropolitana de Barranquilla, Colombia (Barranquilla y Soledad).
Tienes acceso a herramientas para consultar el tráfico real. Conoces hitos urbanos locales como la Vía 40, la Calle 72, la Calle 84, la Circunvalar, el Gran Malecón, 
el Paseo Bolívar, centros comerciales como Buenavista o Viva, el municipio de Soledad, y todos los barrios de la ciudad.
Responde siempre de manera amable, clara y concisa.

Reglas:
1. Respondes SIEMPRE en español, con un tono amable, local y costeño auténtico.
2. **SIEMPRE debes llamar la función \`consultarTraficoBarranquilla\` cuando el usuario pregunte por tráfico, congestión, accidentes, vías, calles, carreras, avenidas, barrios o zonas de Barranquilla o Soledad. No intentes responder basándote en tu conocimiento interno — los datos deben venir de la herramienta.**
3. Si el usuario da una dirección en formato colombiano como "Carrera 46 con Calle 82", "Cra 53 #74-25", "Calle 84 con Cra 55", pásala exactamente como el usuario la escribió a la función, sin agregar "Barranquilla" ni "Soledad" al texto.
4. **Todas las consultas son sobre el área metropolitana de Barranquilla (Barranquilla y Soledad). Si el usuario menciona otra ciudad (Bogotá, Medellín, Cali, Santa Marta, Cartagena, etc.), responde amablemente que solo trabajas con Barranquilla y Soledad, y no llames la función.**
5. Interpreta los datos que recibes:
   - \`velocidad_actual_kmh\` vs \`velocidad_libre_kmh\`: compáralos para determinar cuánto tráfico hay.
   - \`congestion_porcentaje\`: 0-25% = fluido, 25-50% = moderado, 50-75% = congestionado, 75-100% = muy congestionado.
   - \`incidentes\`: si hay eventos, menciónalos con detalles (descripción, ubicación, demora estimada).
6. Si hay incidentes, menciónalos con detalles y su demora estimada.
7. Si no hay datos suficientes o la herramienta devuelve un error, sé honesto y sugiere intentar con otra dirección o revisar el mapa.
8. Usa expresiones costeñas como: "¡papi!", "chévere", "bacano", "a la orden", "uve", "mi llave".
9. Sé breve pero informativo: máximo 3 párrafos.`;

async function geocodificarDireccion(direccion) {
  const url = `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(direccion + ', Barranquilla, Colombia')}.json?key=${process.env.TOMTOM_API_KEY}&limit=1&countrySet=CO`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TomTom Geocoding error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data.results?.length) return null;
  return data.results[0].position;
}

async function consultarFlujoTrafico(lat, lon) {
  const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/relative/10/json?key=${process.env.TOMTOM_API_KEY}&point=${lat},${lon}&unit=KMPH&thickness=1`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TomTom Traffic Flow error ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function consultarIncidentes(lat, lon) {
  const bbox = `${lon - 0.04},${lat - 0.04},${lon + 0.04},${lat + 0.04}`;
  const url = `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${process.env.TOMTOM_API_KEY}&bbox=${bbox}&language=es-ES&timeValidityFilter=present`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TomTom Incidents error ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function formatearDatosFlujo(traficoRaw) {
  if (!traficoRaw?.flowSegmentData) return null;
  const f = traficoRaw.flowSegmentData;
  return {
    velocidad_actual_kmh: f.currentSpeed,
    velocidad_libre_kmh: f.freeFlowSpeed,
    congestion_porcentaje: Math.round((1 - f.currentSpeed / f.freeFlowSpeed) * 100),
    nivel_confianza: f.confidence,
    tiempo_viaje_actual_seg: f.currentTravelTime,
    tiempo_viaje_libre_seg: f.freeFlowTravelTime,
  };
}

function formatearIncidentes(incidentesRaw) {
  if (!incidentesRaw?.incidents?.length) return [];
  return incidentesRaw.incidents.map(inc => ({
    tipo: inc.properties.iconCategory,
    gravedad: inc.properties.magnitudeOfDelay,
    descripcion: inc.properties.events?.map(e => e.description).join('; ') || '',
    desde: inc.properties.from,
    hasta: inc.properties.to,
    longitud_km: inc.properties.length,
    demora_min: inc.properties.delay ? Math.round(inc.properties.delay / 60) : null,
  }));
}

async function ejecutarConsultarTrafico(direccion_o_zona) {
  try {
    const posicion = await geocodificarDireccion(direccion_o_zona);
    if (!posicion) {
      return { error: `No se encontró "${direccion_o_zona}" en Barranquilla. ¿Puedes ser más específico?` };
    }

    if (!estaEnAreaMetropolitana(posicion.lat, posicion.lon)) {
      return { error: `"${direccion_o_zona}" no está en el área metropolitana de Barranquilla o Soledad. Solo puedo consultar tráfico dentro de Barranquilla y Soledad, Colombia.` };
    }

    const [trafico, incidentes] = await Promise.all([
      consultarFlujoTrafico(posicion.lat, posicion.lon),
      consultarIncidentes(posicion.lat, posicion.lon),
    ]);

    return {
      direccion_consultada: direccion_o_zona,
      coordenadas: { lat: posicion.lat, lon: posicion.lon },
      flujo: formatearDatosFlujo(trafico),
      incidentes: formatearIncidentes(incidentes),
    };
  } catch (err) {
    console.error('Error en ejecutarConsultarTrafico:', err);
    return { error: `Error al consultar datos de tráfico para "${direccion_o_zona}": ${err.message}` };
  }
}

app.post('/api/chat', async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message?.trim()) {
    return res.status(400).json({ error: 'El mensaje no puede estar vacío.' });
  }

  const normalizeRole = (r) => r === 'assistant' ? 'model' : r;

  const contents = [
    ...history.map(m => ({ ...m, role: normalizeRole(m.role) })),
    { role: 'user', parts: [{ text: message }] },
  ];

  let ultimasCoordenadas = null;

  // --- Primera llamada a Gemini ---
  let response;
  try {
    response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [toolDefinition],
      },
    });
  } catch (err) {
    console.error('Error llamando a Gemini (inicial):', err);
    return res.status(502).json({ error: `Error de conexión con Gemini: ${err.message}` });
  }

  let candidate = response.candidates?.[0];
  if (!candidate?.content) {
    const reason = response.promptFeedback?.blockReason
      || 'el modelo no generó contenido (safety block o respuesta vacía)';
    return res.status(500).json({ error: `Gemini no devolvió contenido: ${reason}` });
  }

  // --- Bucle de function calling ---
  let maxTurns = 5;
  while (maxTurns-- > 0) {
    const parts = candidate.content.parts;
    if (!parts?.length) break;

    const functionCalls = parts.filter(p => p.functionCall);
    if (functionCalls.length === 0) break;

    contents.push({ role: 'model', parts: [...parts] });

    for (const part of functionCalls) {
      const fc = part.functionCall;
      if (fc.name === 'consultarTraficoBarranquilla') {
        const result = await ejecutarConsultarTrafico(fc.args.direccion_o_zona);
        if (result.coordenadas) {
          ultimasCoordenadas = result.coordenadas;
        }
        contents.push({
          role: 'function',
          parts: [{ functionResponse: { name: fc.name, response: result } }],
        });
      }
    }

    try {
      response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents,
        config: {
          tools: [toolDefinition],
        },
      });
    } catch (err) {
      console.error('Error llamando a Gemini (function response):', err);
      return res.status(502).json({ error: `Error de conexión con Gemini tras consultar tráfico: ${err.message}` });
    }

    candidate = response.candidates?.[0];
    if (!candidate?.content) break;
  }

  const texto = candidate?.content?.parts
    ?.filter(p => p.text)
    .map(p => p.text)
    .join('') || '';

  res.json({ response: texto, coordenadas: ultimasCoordenadas });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'QuillaTráfico API' });
});

app.listen(PORT, () => {
  console.log(`🟦 QuillaTráfico API corriendo en http://localhost:${PORT}`);
});
