import { HistoryService } from './history.service';
import { CreateHistoryEventDto } from './dto/create-history-event.dto';
export declare class HistoryController {
    private readonly historyService;
    constructor(historyService: HistoryService);
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
    create(body: CreateHistoryEventDto): Promise<{
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
