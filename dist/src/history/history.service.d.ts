import { PrismaService } from '../prisma/prisma.service';
import { CreateHistoryEventDto } from './dto/create-history-event.dto';
export declare class HistoryService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    private asDate;
    list(): Promise<{
        id: string;
        title: string;
        createdAt: Date;
        user: string;
        eventType: string;
        timestamp: Date;
        criticality: string;
        details: import("@prisma/client/runtime/client").JsonValue;
        hierarchy: string;
    }[]>;
    create(payload: CreateHistoryEventDto): Promise<{
        id: string;
        title: string;
        createdAt: Date;
        user: string;
        eventType: string;
        timestamp: Date;
        criticality: string;
        details: import("@prisma/client/runtime/client").JsonValue;
        hierarchy: string;
    }>;
}
