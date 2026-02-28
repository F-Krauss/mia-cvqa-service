import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { DocumentCategory } from '@prisma/client';
import { DocumentsService } from './documents.service';
import { DocumentIndexingService } from './document-indexing.service';
import { VectorStoreService } from '../ai/vector-store.service';
export declare class DocumentsController {
    private readonly documentsService;
    private readonly documentIndexing;
    private readonly vectorStore;
    constructor(documentsService: DocumentsService, documentIndexing: DocumentIndexingService, vectorStore: VectorStoreService);
    list(req: any, category?: DocumentCategory, entityId?: string, entityType?: string): Promise<{
        id: string;
        storageKey: string;
        originalName: string;
        mimeType: string;
        size: number;
        category: import("@prisma/client").$Enums.DocumentCategory;
        entityType: string | null;
        entityId: string | null;
        title: string | null;
        code: string | null;
        version: string | null;
        status: string | null;
        owner: string | null;
        nextReview: Date | null;
        ragEnabled: boolean;
        ragStatus: string | null;
        aiSummary: string | null;
        aiResume: string | null;
        aiTags: string[];
        aiProcessedAt: Date | null;
        aiProcessingStatus: string | null;
        embeddingStatus: string | null;
        embeddingProcessedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
        aiDocType: string | null;
        aiSafetyInstructions: string[];
        areas: {
            area: {
                id: string;
                name: string;
                description: string | null;
            };
            areaId: string;
        }[];
    }[]>;
    upload(req: any, file?: Express.Multer.File, body?: {
        category?: DocumentCategory;
        entityType?: string;
        entityId?: string;
        title?: string;
        code?: string;
        version?: string;
        status?: string;
        owner?: string;
        nextReview?: string;
        ragEnabled?: string;
        ragStatus?: string;
        areaIds?: string | string[];
    }): Promise<{
        id: string;
        storageKey: string;
        originalName: string;
        mimeType: string;
        size: number;
        category: import("@prisma/client").$Enums.DocumentCategory;
        entityType: string | null;
        entityId: string | null;
        title: string | null;
        code: string | null;
        version: string | null;
        status: string | null;
        owner: string | null;
        nextReview: Date | null;
        ragEnabled: boolean;
        ragStatus: string | null;
        aiSummary: string | null;
        aiResume: string | null;
        aiTags: string[];
        aiProcessedAt: Date | null;
        aiProcessingStatus: string | null;
        embeddingStatus: string | null;
        embeddingProcessedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
        aiDocType: string | null;
        aiSafetyInstructions: string[];
        areas: {
            area: {
                id: string;
                name: string;
                description: string | null;
            };
            areaId: string;
        }[];
    }>;
    updateMetadata(req: any, id: string, body?: {
        originalName?: string | null;
        title?: string | null;
        code?: string | null;
        version?: string | null;
        status?: string | null;
        owner?: string | null;
        nextReview?: string | null;
        ragEnabled?: string | boolean | null;
        ragStatus?: string | null;
        entityType?: string | null;
        entityId?: string | null;
        areaIds?: string | string[] | null;
    }): Promise<{
        id: string;
        storageKey: string;
        originalName: string;
        mimeType: string;
        size: number;
        category: import("@prisma/client").$Enums.DocumentCategory;
        entityType: string | null;
        entityId: string | null;
        title: string | null;
        code: string | null;
        version: string | null;
        status: string | null;
        owner: string | null;
        nextReview: Date | null;
        ragEnabled: boolean;
        ragStatus: string | null;
        aiSummary: string | null;
        aiResume: string | null;
        aiTags: string[];
        aiProcessedAt: Date | null;
        aiProcessingStatus: string | null;
        embeddingStatus: string | null;
        embeddingProcessedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
        aiDocType: string | null;
        aiSafetyInstructions: string[];
        areas: {
            area: {
                id: string;
                name: string;
                description: string | null;
            };
            areaId: string;
        }[];
    }>;
    view(req: any, id: string, res: Response): Promise<StreamableFile>;
    download(req: any, id: string, res: Response): Promise<StreamableFile>;
    getEmbeddingStatus(req: any, id: string): Promise<{
        documentId: string;
        status: any;
        ready: boolean;
    }>;
    reindexPending(limit?: string): Promise<{
        success: boolean;
        queued: number;
    }>;
    reindexDocument(req: any, id: string): Promise<{
        success: boolean;
        queued: boolean;
    }>;
    private parseAreaIds;
}
