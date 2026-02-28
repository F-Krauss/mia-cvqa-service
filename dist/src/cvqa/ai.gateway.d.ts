import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WorkOrderAiService } from './work-order-ai.service';
import { AiPubSubService } from '../queue/ai-pubsub.service';
import { AiService } from './ai.service';
export declare class AiGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
    private readonly aiService;
    private readonly workOrderAiService;
    private readonly aiPubSubService;
    server: Server;
    private readonly logger;
    constructor(aiService: AiService, workOrderAiService: WorkOrderAiService, aiPubSubService: AiPubSubService);
    private buildUserQuery;
    private enrichTechnicianChatPayload;
    afterInit(): void;
    handleConnection(client: Socket): void;
    handleDisconnect(client: Socket): void;
    handleRequestReport(data: {
        payload: any;
        user?: any;
        organizationId?: string;
    }, client: Socket): Promise<void>;
    handleRequestChatStream(data: {
        payload: any;
        user?: any;
        organizationId?: string;
    }, client: Socket): Promise<void>;
    private dispatchAiTask;
    handleRequestDiagnosis(data: {
        payload: any;
        user?: any;
        organizationId?: string;
    }, client: Socket): Promise<void>;
    handleRequestOperatorPlan(data: {
        payload: any;
        user?: any;
        organizationId?: string;
    }, client: Socket): Promise<void>;
    handleRequestTroubleshootingStep(data: {
        payload: any;
        user?: any;
        organizationId?: string;
    }, client: Socket): Promise<void>;
    handleRequestResolutionDraft(data: {
        payload: any;
        user?: any;
        organizationId?: string;
    }, client: Socket): Promise<void>;
    handleRequestEscalationDraft(data: {
        payload: any;
        user?: any;
        organizationId?: string;
    }, client: Socket): Promise<void>;
    handleRequestTechnicianChat(data: {
        payload: any;
        user?: any;
        organizationId?: string;
    }, client: Socket): Promise<void>;
    handleRequestTechnicianImageCheck(data: {
        payload: any;
        user?: any;
        organizationId?: string;
    }, client: Socket): Promise<void>;
    handleOcrTemplate(data: {
        fileBase64: string;
        fileName: string;
        mimeType: string;
        options?: any;
    }, client: Socket): Promise<void>;
    handleOcrExtract(data: {
        fileBase64: string;
        fileName: string;
        mimeType: string;
        schema: any;
        options?: any;
    }, client: Socket): Promise<void>;
    handleOcrVerify(data: {
        fileBase64: string;
        fileName: string;
        mimeType: string;
        extractedData: any;
        schema: any;
        options?: any;
    }, client: Socket): Promise<void>;
    private buildOcrFormData;
    private forwardToOcrService;
}
