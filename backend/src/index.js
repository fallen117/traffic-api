import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:4200',
  methods: ['POST'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const toolDefinition = {
  functionDeclarations: [{
    name: 'consultarTraficoBarranquilla',
    description: 'Consulta el estado del tráfico en una dirección o zona específica de Barranquilla, Colombia. Convierte la dirección a coordenadas (geocoding) y obtiene el flujo de tráfico e incidentes actuales.',
    parameters: {
      type: 'object',
      properties: {
        direccion_o_zona: {
          type: 'string',
          description: 'Dirección, barrio, centro comercial o punto de referencia en Barranquilla, Colombia. Ej: "Centro Comercial Viva", "Calle 84 con Carrera 55", "Parque Washington", "Norte de Barranquilla"'
        }
      },
      required: ['direccion_o_zona']
    }
  }]
};

const SYSTEM_INSTRUCTION = `Eres "QuillaTráfico", un asistente experto en tráfico de Barranquilla, Colombia.
Tienes acceso a herramientas para consultar el tráfico real. Conoces hitos urbanos locales como la Vía 40, la Calle 72, la Calle 84, la Circunvalar, el Gran Malecón, 
el Paseo Bolívar y centros comerciales como Buenavista o Viva. 
Si el usuario te pregunta por el tráfico en un sector, usa la función correspondiente. Responde siempre de manera amable, clara y concisa.

Reglas:
1. Respondes SIEMPRE en español, con un tono amable, local y costeño auténtico.
2. Cuando te pregunten sobre el tráfico en una dirección o zona, usa la función \`consultarTraficoBarranquilla\`.
3. Interpreta los datos que recibes:
   - Velocidad actual vs velocidad libre (cuánto tráfico hay).
   - Nivel de congestión (bajo, moderado, alto).
   - Incidentes reportados (accidentes, obras, etc.).
4. Si hay incidentes, menciónalos con detalles.
5. Si no hay datos suficientes, sé honesto y sugiere revisar el mapa.
6. Usa expresiones costeñas como: "¡papi!", "chévere", "bacano", "a la orden", "uve", "mi llave".
7. Sé breve pero informativo.`;

async function geocodificarDireccion(direccion) {
  const url = `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(direccion + ', Barranquilla, Colombia')}.json?key=${process.env.TOMTOM_API_KEY}&limit=1`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.results?.length) return null;
  return data.results[0].position;
}

async function consultarFlujoTrafico(lat, lon) {
  const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/relative/10/json?key=${process.env.TOMTOM_API_KEY}&point=${lat},${lon}&unit=km/h&thickness=1`;
  const res = await fetch(url);
  return res.json();
}

async function consultarIncidentes(lat, lon) {
  const bbox = `${lon - 0.02},${lat - 0.02},${lon + 0.02},${lat + 0.02}`;
  const url = `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${process.env.TOMTOM_API_KEY}&bbox=${bbox}&language=es-ES&timeValidityFilter=present`;
  const res = await fetch(url);
  return res.json();
}

async function ejecutarConsultarTrafico(direccion_o_zona) {
  const posicion = await geocodificarDireccion(direccion_o_zona);
  if (!posicion) {
    return { error: `No se encontró "${direccion_o_zona}" en Barranquilla. ¿Puedes ser más específico?` };
  }

  const [trafico, incidentes] = await Promise.all([
    consultarFlujoTrafico(posicion.lat, posicion.lon),
    consultarIncidentes(posicion.lat, posicion.lon),
  ]);

  return {
    direccion_consultada: direccion_o_zona,
    coordenadas: { lat: posicion.lat, lon: posicion.lon },
    trafico,
    incidentes,
  };
}

app.post('/api/chat', async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message?.trim()) {
      return res.status(400).json({ error: 'El mensaje no puede estar vacío.' });
    }

    const normalizeRole = (r) => r === 'assistant' ? 'model' : r;

    const contents = [
      ...history.map(m => ({ ...m, role: normalizeRole(m.role) })),
      { role: 'user', parts: [{ text: message }] },
    ];

    let response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [toolDefinition],
      },
    });

    let candidate = response.candidates?.[0];
    if (!candidate) {
      return res.status(500).json({ error: 'No se pudo generar respuesta del modelo.' });
    }

    let ultimasCoordenadas = null;

    let maxTurns = 5;
    while (maxTurns-- > 0) {
      const parts = candidate.content.parts;
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

      response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents,
        config: {
          tools: [toolDefinition],
        },
      });

      candidate = response.candidates?.[0];
      if (!candidate) break;
    }

    const texto = candidate.content.parts
      .filter(p => p.text)
      .map(p => p.text)
      .join('');

    res.json({ response: texto, coordenadas: ultimasCoordenadas });
  } catch (error) {
    console.error('Error en /api/chat:', error);
    res.status(500).json({ error: 'Error interno al procesar la consulta.' });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'QuillaTráfico API' });
});

app.listen(PORT, () => {
  console.log(`🟦 QuillaTráfico API corriendo en http://localhost:${PORT}`);
});
