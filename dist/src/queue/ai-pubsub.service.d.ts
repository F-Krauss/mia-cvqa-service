import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { WorkOrderAiService } from '../ai/work-order-ai.service';
export type AiTaskType = 'diagnosis' | 'operator-plan' | 'troubleshooting-step' | 'resolution-draft' | 'escalation-draft' | 'technician-chat' | 'technician-image-check';
export type AiPubSubMessage = {
    taskType: AiTaskType;
    clientId: string;
    payload: any;
    user?: any;
    organizationId?: string;
};
type AiResultEmitter = (clientId: string, event: string, data: any) => void;
export declare class AiPubSubService implements OnModuleInit, OnModuleDestroy {
    private readonly aiService;
    private readonly workOrderAiService;
    private readonly logger;
    private pubSubClient?;
    private subscription?;
    private emitter?;
    constructor(aiService: AiService, workOrderAiService: WorkOrderAiService);
    setEmitter(emitter: AiResultEmitter): void;
    onModuleInit(): Promise<void>;
    onModuleDestroy(): Promise<void>;
    private isNonRetryableError;
    publishTask(message: AiPubSubMessage): Promise<string | undefined>;
    private startListening;
    private processMessage;
    private emit;
}
export {};
