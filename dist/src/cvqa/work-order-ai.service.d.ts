import { AiUsageService } from './ai-usage.service';
type WorkOrderContextPayload = {
    workOrderId?: string;
    otNumber?: string;
    plantName?: string;
    processName?: string;
    subprocessName?: string;
    machineCode?: string;
    machineName?: string;
    reportDate?: string;
    detectorName?: string;
    shift?: string;
    requestType?: string;
    machineStatus?: string;
    safetyRisk?: string;
    failureDescription?: string;
    symptoms?: string[];
    troubleshootingResults?: string[];
    possibleCauses?: string[];
    manualInsights?: string[];
    manualSources?: Array<{
        document: string;
        pages?: string;
        url?: string;
    }>;
    workInstructions?: Array<{
        id: string;
        title: string;
        relevance?: string;
        summary?: string;
        steps?: any;
        expectedResult?: any;
    }>;
    similarWorkOrders?: Array<{
        id: string;
        otNumber: string;
        summary: string;
        relevance?: string;
    }>;
    referenceDictionary?: string;
    queryIntent?: 'diagnostic' | 'procedure_request' | 'clarification' | 'parts_check' | 'safety_question';
    compressedConversationContext?: string;
    previousTechnicianSteps?: string[];
    currentSelectedProcedure?: string;
    workflowStage?: 'procedure' | 'output';
};
type TechnicianMessagePayload = {
    threadType?: 'applied_procedure' | 'output' | 'evidence';
    selectedSolution?: string;
    appliedProcedure?: string;
    output?: string;
    evidence?: string;
    overrideMode?: boolean;
    workflowStage?: 'procedure' | 'output';
    partsDecision?: 'none' | 'generate_and_finish' | 'decline_generate_keep_search' | 'decline_generate_stop_chat';
};
type TechnicianConversationMessage = {
    role: 'user' | 'assistant';
    content: string;
    timestamp?: string;
};
type SuggestedPartDetail = {
    description: string;
    partNumber?: string;
    vendor?: string;
    model?: string;
    quantity?: string;
    urgency: 'immediate' | 'scheduled' | 'monitor';
    sourceDocument?: string;
};
type WorkOrderTechnicianChatPayload = {
    context?: WorkOrderContextPayload;
    message?: TechnicianMessagePayload;
    threadHistory?: TechnicianConversationMessage[];
};
type WorkOrderTechnicianImageCheckPayload = {
    context?: WorkOrderContextPayload;
    imageBase64?: string;
    imageMimeType?: string;
    technicianQuestion?: string;
    selectedProcedure?: string;
    threadHistory?: TechnicianConversationMessage[];
};
type WorkOrderTechnicianChatResult = {
    assistantMessage: string;
    nextSolutions: string[];
    likelyCauses: string[];
    causeProcedurePairs?: Array<{
        cause: string;
        procedure: string;
    }>;
    toolsAndMaterials: string[];
    recommendedThread: 'applied_procedure' | 'output' | 'evidence';
    detectedOutcome: 'good' | 'bad' | 'unknown';
    suggestedOutput: string;
    partsRequiredDetected?: boolean;
    partsRequiredReason?: string;
    suggestedParts?: string[];
    suggestedPartDetails?: SuggestedPartDetail[];
    shouldAskToGeneratePieceOrder?: boolean;
    shouldAskToContinueAfterDecline?: boolean;
    sourceCitations?: Array<{
        document: string;
        pages?: string;
    }>;
    confidenceLevel?: 'high' | 'medium' | 'low';
};
type WorkOrderTechnicianReportPayload = {
    context?: WorkOrderContextPayload;
    threads?: {
        appliedProcedure?: TechnicianConversationMessage[];
        output?: TechnicianConversationMessage[];
        evidence?: TechnicianConversationMessage[];
    };
    technicianObservations?: string;
    workingSolution?: string;
    needsParts?: boolean;
};
type MaintenanceRiskFlag = {
    riskLevel: 'critical' | 'high' | 'medium' | 'low';
    component: string;
    predictedIssue: string;
    probability: 'likely' | 'possible' | 'watch';
    recommendedAction: string;
    timeframe: string;
    basedOn: string;
};
type WorkOrderTechnicianReportResult = {
    summary: string;
    recommendation: 'close' | 'hold_for_parts';
    requiredParts: string[];
    reportText: string;
    technicalReport: {
        inspections: string;
        measurements: string;
        observations: string;
        diagnosis: string;
        rootCause: string;
        actions: string[];
        otherActionDetail: string;
        supplies: Array<{
            description: string;
            quantity: string;
        }>;
        preventiveMeasures: string;
    };
    feedbackLearnings: Array<{
        procedure: string;
        outcome: 'good' | 'bad';
        rationale: string;
    }>;
    maintenanceRisk: MaintenanceRiskFlag[];
};
export declare class WorkOrderAiService {
    private readonly aiUsageService;
    private readonly vertexAI;
    private readonly chatModel;
    private readonly reportModel;
    constructor(aiUsageService: AiUsageService);
    private ensureChatModel;
    private ensureReportModel;
    private generateContentWithRetry;
    private generateContentStreamWithRetry;
    private extractJsonObject;
    private normalizeStringArray;
    private normalizeLooseTextKey;
    private sanitizeAssistantAddressing;
    private enforceManualGroundingLanguage;
    private enforceFormalAssistantTone;
    private normalizeCauseProcedurePairs;
    private normalizeSourceCitations;
    private normalizeSuggestedPartDetails;
    private normalizeMaintenanceRisk;
    private normalizeCitationDocumentKey;
    private mapRole;
    private summarizeConversationContext;
    private buildTechnicianChatHistory;
    private formatContext;
    private truncateForPrompt;
    private getTechnicianChatJsonSchema;
    private buildTechnicianChatPrompt;
    chat(payload: WorkOrderTechnicianChatPayload, user?: {
        sub?: string;
    }, organizationId?: string): Promise<WorkOrderTechnicianChatResult>;
    chatStream(payload: WorkOrderTechnicianChatPayload, user?: {
        sub?: string;
    }, organizationId?: string, onChunk?: (text: string) => void): Promise<WorkOrderTechnicianChatResult>;
    analyzeImage(payload: WorkOrderTechnicianImageCheckPayload, user?: {
        sub?: string;
    }, organizationId?: string): Promise<WorkOrderTechnicianChatResult>;
    generateReport(payload: WorkOrderTechnicianReportPayload, user?: {
        sub?: string;
    }, organizationId?: string): Promise<WorkOrderTechnicianReportResult>;
    generateReportStream(payload: WorkOrderTechnicianReportPayload, user?: {
        sub?: string;
    }, organizationId?: string, onChunk?: (text: string) => void): Promise<WorkOrderTechnicianReportResult>;
}
export {};
