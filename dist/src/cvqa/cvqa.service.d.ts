import { DocumentsService } from '../documents/documents.service';
import { DocumentIndexingService } from '../documents/document-indexing.service';
import { AiUsageService } from './ai-usage.service';
import { HistoryService } from '../history/history.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { PrismaService } from '../prisma/prisma.service';
import { VectorStoreService } from './vector-store.service';
import { CacheService } from '../common/cache.service';
type QuickVersionCheckResult = {
    requiresConfirmation: boolean;
    differenceLevel: 'low' | 'medium' | 'high' | 'unknown';
    reason: string;
    highlights: string[];
    scores: {
        lexicalSimilarity: number | null;
        aiDifferenceScore: number | null;
    };
};
type WorkOrderFormData = {
    failureDescription?: string;
    symptoms?: string[];
    currentStatus?: string;
    safetyRisk?: string;
    failureMoment?: string;
    alarmCodes?: string;
    alarmMessages?: string;
    sinceWhen?: string;
    frequency?: string;
    operatingHours?: string;
    recentAdjustments?: string;
    adjustmentsDetail?: string;
    productionImpact?: string;
    qualityImpact?: string;
    defectType?: string;
    defectDescription?: string;
};
type WorkOrderDiagnosisPayload = {
    workOrderId?: string;
    machineId?: string;
    plantId?: string;
    processId?: string;
    subprocessId?: string;
    machineName?: string;
    machineModel?: string;
    machineManufacturer?: string;
    plantName?: string;
    processName?: string;
    subprocessName?: string;
    machineDocumentIds?: string[];
    formData?: WorkOrderFormData;
};
type WorkOrderDiagnosisResult = {
    classification: string;
    priority: 'P1' | 'P2' | 'P3';
    riskLevel: 'Alto' | 'Medio' | 'Bajo';
    productionImpact: string;
    qualityImpact: boolean;
    operatorInstructions: string;
    rootCauses: Array<{
        cause: string;
        probability: string;
    }>;
    suggestedActions: string[];
    diagnosisDetails: string;
    stepsToFix: Array<{
        step: number;
        title: string;
        description: string;
        tools?: string[];
        safetyPrecautions?: string[];
        estimatedTime?: string;
    }>;
};
type OperatorInputType = 'text' | 'image' | 'text_or_image';
type TroubleshootingStep = {
    stepNumber: number;
    title: string;
    instruction: string;
    expectedOperatorInput: OperatorInputType;
};
type WorkOrderOperatorPlanResult = {
    classification: string;
    priority: 'P1' | 'P2' | 'P3';
    riskLevel: 'Alto' | 'Medio' | 'Bajo';
    productionImpact: string;
    qualityImpact: boolean;
    safetyInstructions: string[];
    hasBasicTroubleshooting: boolean;
    troubleshootingTitle: string;
    firstStep?: TroubleshootingStep;
    maxTroubleshootingSteps: number;
    possibleProblems: string[];
    suggestedToolsAndMaterials: string[];
    operatorInstructions: string;
};
type TroubleshootingHistoryEntry = {
    stepNumber?: number;
    title?: string;
    instruction?: string;
    operatorInputText?: string;
    operatorImageNotes?: string[];
};
type WorkOrderTroubleshootingStepPayload = {
    workOrderId?: string;
    machineId?: string;
    plantId?: string;
    processId?: string;
    subprocessId?: string;
    machineName?: string;
    machineModel?: string;
    machineManufacturer?: string;
    plantName?: string;
    processName?: string;
    subprocessName?: string;
    machineDocumentIds?: string[];
    formData?: WorkOrderFormData;
    safetyInstructions?: string[];
    possibleProblems?: string[];
    suggestedToolsAndMaterials?: string[];
    maxTroubleshootingSteps?: number;
    troubleshootingHistory?: TroubleshootingHistoryEntry[];
};
type WorkOrderTroubleshootingStepResult = {
    shouldEscalate: boolean;
    reason: string;
    nextStep?: TroubleshootingStep;
    maxStepsReached: boolean;
};
type WorkOrderResolutionDraftPayload = WorkOrderTroubleshootingStepPayload & {
    finalOperatorNote?: string;
};
type WorkOrderResolutionDraftResult = {
    resolutionSummary: string;
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
};
type WorkOrderEscalationDraftPayload = WorkOrderTroubleshootingStepPayload & {
    reportDate?: string;
    machineCode?: string;
    detectorName?: string;
    shift?: string;
    requestType?: string;
    operatorName?: string;
};
type WorkOrderEscalationDraftResult = {
    subjectLine: string;
    quickSummary: string;
    possibleProblems: string[];
    toolsAndMaterials: string[];
    fullContext: string;
};
type WorkOrderTechnicianContextPayload = {
    workOrderId?: string;
    otNumber?: string;
    machineId?: string;
    plantId?: string;
    processId?: string;
    subprocessId?: string;
    plantName?: string;
    processName?: string;
    subprocessName?: string;
    machineCode?: string;
    machineName?: string;
    machineModel?: string;
    machineManufacturer?: string;
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
    }>;
    similarWorkOrders?: Array<{
        id: string;
        otNumber: string;
        relevance?: string;
        summary: string;
    }>;
    referenceDictionary?: string;
    queryIntent?: TechnicianQueryIntent;
    compressedConversationContext?: string;
    previousTechnicianSteps?: string[];
    currentSelectedProcedure?: string;
    workflowStage?: 'procedure' | 'output';
};
type TechnicianConversationMessagePayload = {
    role: 'user' | 'assistant';
    content: string;
    timestamp?: string;
};
type TechnicianQueryIntent = 'diagnostic' | 'procedure_request' | 'clarification' | 'parts_check' | 'safety_question';
type WorkOrderReferenceBackfillResult = {
    processed: number;
    updated: number;
    skipped: number;
    failed: number;
    errors: Array<{
        workOrderId: string;
        message: string;
    }>;
};
type AiUserContext = {
    sub?: string;
    email?: string;
    organizationId?: string;
    areas?: string[];
    roleLevels?: string[];
    roles?: string[];
    permissions?: string[];
};
export declare class AiService {
    private readonly documentsService;
    private readonly documentIndexing;
    private readonly aiUsageService;
    private readonly vectorStore;
    private readonly historyService;
    private readonly approvalsService;
    private readonly prisma;
    private readonly cacheService;
    private readonly vertexAI;
    private readonly model;
    private readonly answerCache;
    private readonly answerCacheTtlSeconds;
    private readonly referenceEmbeddingCache;
    private readonly referenceContextCache;
    private warnedMissingWorkOrderReferenceFields;
    private warnedMissingWorkInstructionDocumentLinks;
    constructor(documentsService: DocumentsService, documentIndexing: DocumentIndexingService, aiUsageService: AiUsageService, vectorStore: VectorStoreService, historyService: HistoryService, approvalsService: ApprovalsService, prisma: PrismaService, cacheService: CacheService);
    private generateContentWithRetry;
    private sendChatMessageWithRetry;
    generateWorkOrderSummary(rawText: string): Promise<string>;
    consult(query: string, documentIds: string[], contextLabel?: string, history?: {
        role: 'user' | 'assistant';
        content: string;
    }[], user?: {
        sub?: string;
        email?: string;
        organizationId?: string;
        areas?: string[];
        roleLevels?: string[];
        roles?: string[];
        permissions?: string[];
    }, organizationId?: string): Promise<{
        answer: string;
        notice: string | null;
        sources?: undefined;
        mode?: undefined;
    } | {
        answer: string;
        sources: import("./vector-store.service").RetrievedChunk[];
        notice: string | null;
        mode: string;
    }>;
    private loadDocument;
    private extractContentPart;
    private extractTextFromPart;
    private buildComparisonSnippet;
    private parseScore;
    private calculateLexicalSimilarity;
    private tokenizeForSimilarity;
    private trimText;
    private buildAnswerCacheKey;
    private logVertexResponse;
    private logVertexError;
    private extractVertexPreview;
    private streamToBuffer;
    private normalizeSearchText;
    private tokenizeSearchText;
    private expandSearchTextWithJargon;
    private buildTokenSet;
    private classifyTechnicianQuery;
    private summarizeConversationContext;
    private buildStructuredSignalTokens;
    private fuseRrfScores;
    private scoreTokenOverlap;
    private buildReferenceContextCacheKey;
    private isMissingWorkOrderContextCacheTable;
    private safeFindWorkOrderContextCache;
    private safeUpdateWorkOrderContextCache;
    private safeUpsertWorkOrderContextCache;
    private buildReferenceEmbeddingText;
    private cosineSimilarity;
    private embedReferenceQuery;
    private embedReferenceCandidates;
    private buildReferenceRelevance;
    private buildWorkOrderReferenceQuery;
    private buildWorkInstructionSearchText;
    private buildWorkInstructionSummary;
    private buildWorkOrderSearchText;
    private buildWorkOrderSummary;
    private truncateReferenceText;
    private formatWorkInstructionReferences;
    private formatWorkOrderReferences;
    private uniqueStrings;
    private mergeManualSources;
    private mergeWorkInstructionRefs;
    private mergeWorkOrderRefs;
    private buildManualInsightsFromDocuments;
    private extractDocumentIdFromEvidenceUrl;
    private extractEvidenceDocumentIds;
    private formatCrossReferencedDocuments;
    private buildReferenceDictionaryText;
    private resolveWorkInstructionLinkedDocuments;
    private resolveCrossReferencedDocuments;
    private resolveWorkInstructionReferences;
    private resolveSimilarWorkOrders;
    private resolveWorkOrderReferenceContext;
    private parseBooleanFlag;
    private mergeReferenceRecords;
    private persistAutoReferenceSnapshot;
    private buildSelectionPayloadFromTechnicianContext;
    enrichTechnicianContext(context: WorkOrderTechnicianContextPayload, organizationId?: string, options?: {
        userQuery?: string;
        conversationHistory?: TechnicianConversationMessagePayload[];
    }): Promise<WorkOrderTechnicianContextPayload>;
    preloadWorkOrderContext(workOrderId: string, context: WorkOrderTechnicianContextPayload, organizationId?: string): Promise<void>;
    enrichTechnicianContextWithCache(workOrderId: string, context: WorkOrderTechnicianContextPayload, userQuery?: string, organizationId?: string, conversationHistory?: TechnicianConversationMessagePayload[]): Promise<WorkOrderTechnicianContextPayload>;
    private checkSemanticCacheMatch;
    private shouldExpandCache;
    private expandCachedContext;
    recordTechnicianProcedureSelection(payload: {
        workOrderId?: string;
        context?: WorkOrderTechnicianContextPayload;
        selectedProcedure?: string;
        organizationId?: string;
    }): Promise<void>;
    backfillClosedWorkOrderReferences(options?: {
        limit?: number;
        force?: boolean;
    }): Promise<WorkOrderReferenceBackfillResult>;
    private buildWorkOrderDocQuery;
    private scoreWorkOrderDocument;
    private rankWorkOrderDocumentIds;
    private buildWorkOrderDocInsights;
    private resolveWorkOrderDocumentContext;
    generateWorkOrderDiagnosis(payload: WorkOrderDiagnosisPayload, user?: {
        sub?: string;
        email?: string;
        organizationId?: string;
        areas?: string[];
        roleLevels?: string[];
        roles?: string[];
        permissions?: string[];
    }, organizationId?: string): Promise<WorkOrderDiagnosisResult>;
    generateWorkOrderOperatorPlan(payload: WorkOrderDiagnosisPayload, user?: {
        sub?: string;
        email?: string;
        organizationId?: string;
        areas?: string[];
        roleLevels?: string[];
        roles?: string[];
        permissions?: string[];
    }, organizationId?: string): Promise<WorkOrderOperatorPlanResult>;
    generateWorkOrderTroubleshootingNextStep(payload: WorkOrderTroubleshootingStepPayload, user?: {
        sub?: string;
        email?: string;
        organizationId?: string;
        areas?: string[];
        roleLevels?: string[];
        roles?: string[];
        permissions?: string[];
    }, organizationId?: string): Promise<WorkOrderTroubleshootingStepResult>;
    generateWorkOrderResolutionDraft(payload: WorkOrderResolutionDraftPayload, user?: {
        sub?: string;
        email?: string;
        organizationId?: string;
        areas?: string[];
        roleLevels?: string[];
        roles?: string[];
        permissions?: string[];
    }, organizationId?: string): Promise<WorkOrderResolutionDraftResult>;
    generateWorkOrderEscalationDraft(payload: WorkOrderEscalationDraftPayload, user?: {
        sub?: string;
        email?: string;
        organizationId?: string;
        areas?: string[];
        roleLevels?: string[];
        roles?: string[];
        permissions?: string[];
    }, organizationId?: string): Promise<WorkOrderEscalationDraftResult>;
    private extractJsonObject;
    private normalizeWorkOrderDiagnosis;
    private fallbackPriority;
    private fallbackRisk;
    private normalizeStringArray;
    private normalizeOperatorInputType;
    private normalizeTroubleshootingStep;
    private normalizeMaxTroubleshootingSteps;
    private formatTroubleshootingHistory;
    private normalizeWorkOrderOperatorPlan;
    private normalizeTroubleshootingStepResult;
    private normalizeWorkOrderResolutionDraft;
    private normalizeWorkOrderEscalationDraft;
    compareProcedureVersions(approvalId: string, user?: {
        sub?: string;
        email?: string;
        organizationId?: string;
        areas?: string[];
        roleLevels?: string[];
        roles?: string[];
        permissions?: string[];
    }, organizationId?: string): Promise<{
        analysis: string;
        metadata: {
            procedureName: {
                current: string;
                previous: string;
            };
            documentName: {
                current: string;
                previous: string;
            };
            version: {
                current: string;
                previous: string;
            };
            uploadDate: {
                current: Date;
                previous: Date;
            };
            status: {
                current: string;
                previous: string;
            };
            documentsCount: number;
        };
        currentVersion: {
            version: string;
            fileName: string;
            uploadDate: Date;
        };
        previousVersion: {
            version: string;
            fileName: string;
            uploadDate: Date;
        };
    }>;
    quickVersionCheck(params: {
        currentFileId: string;
        previousFileId: string;
        currentFileName?: string;
        previousFileName?: string;
        documentName?: string;
    }, user?: AiUserContext, organizationId?: string): Promise<QuickVersionCheckResult>;
    generateDocumentResume(fileId: string, fileName: string, user?: {
        areas?: string[];
        roleLevels?: string[];
        roles?: string[];
        permissions?: string[];
    }): Promise<string | null>;
    private loadDocumentVersion;
    saveFeedback(payload: {
        userId: string;
        organizationId: string;
        query: string;
        response: string;
        rating: number;
        documentIds: string[];
    }): Promise<{
        query: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        response: string;
        rating: number;
        documentIds: string[];
        organizationId: string;
        userId: string;
    }>;
    verifyWorkInstructionStep(payload: {
        goldenSampleUrl: string;
        validationImageUrl: string;
        rules?: Array<{
            id: string;
            description: string;
            highlight?: {
                x: number;
                y: number;
                w: number;
                h: number;
            };
            color?: string;
        }>;
    }, user?: any, organizationId?: string): Promise<any>;
}
export {};
