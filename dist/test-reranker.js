"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vertexai_1 = require("@google-cloud/vertexai");
async function runTest() {
    const projectId = process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'mia-test-ocr';
    const location = 'us-central1';
    console.log(`Using Project: ${projectId}`);
    const vertex = new vertexai_1.VertexAI({ project: projectId, location });
    const model = vertex.preview.getGenerativeModel({
        model: 'gemini-2.5-flash',
    });
    const query = "El motor principal se sobrecalienta y marca error E-34";
    const chunks = [
        { id: '1', text: "El error E-34 indica un problema en el sistema de enfriamiento del motor principal. Solución: Revisar la válvula de refrigerante B2 y comprobar niveles." },
        { id: '2', text: "La máquina de inyección secundaria tuvo un sobrecalentamiento ayer pero no mostró código." },
        { id: '3', text: "El sistema de aire acondicionado del edificio central funciona con un motor de 500W." },
        { id: '4', text: "Mantenimiento preventivo: Limpiar filtros del motor principal cada 3 meses para evitar cualquier error de tipo E-XX." }
    ];
    console.log("=== Original Chunks ===");
    chunks.forEach(c => console.log(`- [${c.id}] ${c.text.substring(0, 50)}...`));
    console.log("\n=== Reranking ===");
    const scoredChunks = await Promise.all(chunks.map(async (chunk) => {
        try {
            const prompt = `Actúa como un Juez Técnico (Cross-Encoder). Evalúa qué tan relevante es el siguiente "Fragmento de Documento" para responder a la "Pregunta del Usuario".
        
        Pregunta del Usuario: "${query}"
        
        Fragmento de Documento:
        "${chunk.text}"
        
        Instrucciones para calificar:
        1. Asigna un Score de 0.0 a 1.0.
        2. 1.0 = Responde directamente la pregunta o es contexto crucial.
        3. 0.8 = Muy relacionado, útil para la respuesta.
        4. 0.5 = Tangencialmente relacionado, menciona los mismos términos pero no el contexto correcto.
        5. 0.1 = Completamente irrelevante.
        
        OUTPUT ESTRICTO: Devuelve un JSON con la clave "score". Ejemplo: {"score": 0.85}`;
            const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.0,
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: vertexai_1.FunctionDeclarationSchemaType.OBJECT,
                        properties: {
                            score: { type: vertexai_1.FunctionDeclarationSchemaType.NUMBER }
                        }
                    }
                }
            });
            const response = await result.response;
            const jsonText = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{"score": 0}';
            const parsed = JSON.parse(jsonText);
            const score = parsed.score;
            console.log(`Chunk ${chunk.id} -> Raw Score Text: "${jsonText}" -> Parsed Float: ${score}`);
            return { ...chunk, rerankScore: isNaN(score) ? 0 : score };
        }
        catch (error) {
            console.error(`Failed on chunk ${chunk.id}`, error);
            return { ...chunk, rerankScore: 0 };
        }
    }));
    console.log("\n=== Final Filtered & Sorted (score >= 0.6) ===");
    const final = scoredChunks
        .filter(c => c.rerankScore >= 0.6)
        .sort((a, b) => b.rerankScore - a.rerankScore);
    final.forEach(c => console.log(`- [${c.id}] (Score: ${c.rerankScore}) ${c.text.substring(0, 50)}...`));
}
runTest().catch(console.error);
//# sourceMappingURL=test-reranker.js.map