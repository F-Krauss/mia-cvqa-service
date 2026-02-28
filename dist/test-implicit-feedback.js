"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./src/app.module");
const ai_controller_1 = require("./src/ai/ai.controller");
async function bootstrap() {
    const app = await core_1.NestFactory.createApplicationContext(app_module_1.AppModule);
    const controller = app.get(ai_controller_1.AiController);
    console.log('Sending mock report payload to AiController...');
    const mockPayload = {
        context: {
            workOrderId: "OT-999-MOCK",
            machineName: "Bomba Centrifuga Alta Presion P-101",
            failureDescription: "La bomba vibra excesivamente al llegar a 1500 RPM y el flujo cae esporádicamente."
        },
        threads: {
            appliedProcedure: [
                { role: "user", content: "Voy a purgar la línea de succión para sacar bolsas de aire" },
                { role: "assistant", content: "Excelente. Por favor confirma si después de purgar la vibración disminuye." },
            ],
            output: [
                { role: "user", content: "Purgué la línea durante 5 minutos pero la bomba sigue vibrando igual al subir RPM" },
                { role: "assistant", content: "De acuerdo. Sugiero revisar la alineación del cople." },
                { role: "user", content: "Revisé la alineación y estaba 2mm fuera de tolerancia. Ya la corregí y la vibración desapareció totalmente." }
            ]
        },
        technicianObservations: "El problema era pura alineación, no había bolsas de aire.",
        workingSolution: "Alinear el cople del motor/bomba.",
        needsParts: false
    };
    const mockReq = {
        user: { id: "test-user-123", organizationId: "user-org-123" }
    };
    try {
        const res = await controller.workOrderTechnicianReport(mockPayload, mockReq);
        console.log('\n--- Gemini Report Result ---');
        console.log(JSON.stringify(res.feedbackLearnings, null, 2));
        console.log('\nCheck your PostgreSQL database to see if these learnings were inserted into AIFeedback.');
    }
    catch (err) {
        console.error('Test failed', err);
    }
    await app.close();
    process.exit(0);
}
bootstrap();
//# sourceMappingURL=test-implicit-feedback.js.map