"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApprovalsService = void 0;
const common_1 = require("@nestjs/common");
const pdf_lib_1 = require("pdf-lib");
const prisma_service_1 = require("../prisma/prisma.service");
const documents_service_1 = require("../documents/documents.service");
let ApprovalsService = class ApprovalsService {
    prisma;
    documentsService;
    constructor(prisma, documentsService) {
        this.prisma = prisma;
        this.documentsService = documentsService;
    }
    resolveVersionCreator(version) {
        const fileOwner = version?.file?.owner?.trim();
        if (fileOwner)
            return fileOwner;
        const updatedBy = version?.updatedBy?.trim();
        if (updatedBy)
            return updatedBy;
        return null;
    }
    resolveDocumentCreator(versions) {
        if (!versions?.length)
            return null;
        const sortedByUploadDateAsc = [...versions].sort((a, b) => {
            const aMs = a.uploadDate ? new Date(a.uploadDate).getTime() : 0;
            const bMs = b.uploadDate ? new Date(b.uploadDate).getTime() : 0;
            return aMs - bMs;
        });
        for (const version of sortedByUploadDateAsc) {
            const creator = this.resolveVersionCreator(version);
            if (creator)
                return creator;
        }
        return null;
    }
    async createDocumentApproval(params) {
        return this.prisma.documentApproval.create({
            data: {
                procedureId: params.procedureId,
                documentId: params.documentId,
                reviewerId: params.reviewerId,
                responsibleId: params.responsibleId,
                documentVersionId: params.documentVersionId,
                status: 'pending',
                notifyEmail: params.notifyEmail || false,
                notifyWhatsapp: params.notifyWhatsapp || false,
            },
            include: {
                procedure: true,
                document: true,
                reviewer: true,
                responsible: true,
            },
        });
    }
    async syncPendingApprovals() {
        try {
            console.log('[Approvals] Starting sync of pending approvals (per document)...');
            const procedures = await this.prisma.procedure.findMany({
                where: {
                    reviewerId: { not: null },
                },
                include: {
                    documents: {
                        include: {
                            versions: {
                                orderBy: { version: 'desc' },
                                take: 1,
                            },
                        },
                    },
                },
            });
            console.log('[Approvals] Found', procedures.length, 'procedures with reviewers');
            let syncedCount = 0;
            for (const procedure of procedures) {
                for (const document of procedure.documents) {
                    const latestVersion = document.versions[0];
                    if (!latestVersion) {
                        continue;
                    }
                    const isInReview = latestVersion.status === 'in_review' ||
                        latestVersion.status === 'review' ||
                        latestVersion.status === 'pending';
                    if (!isInReview) {
                        continue;
                    }
                    console.log(`[Approvals] Document "${document.name}" (${document.id}) in procedure "${procedure.title}" is in review`);
                    const existingPendingApproval = await this.prisma.documentApproval.findFirst({
                        where: {
                            documentId: document.id,
                            status: 'pending',
                        },
                    });
                    if (existingPendingApproval) {
                        console.log(`[Approvals] Pending approval already exists for document: ${document.id}`);
                        continue;
                    }
                    const anyApproval = await this.prisma.documentApproval.findFirst({
                        where: {
                            documentId: document.id,
                        },
                        orderBy: {
                            updatedAt: 'desc',
                        },
                    });
                    if (procedure.reviewerId) {
                        if (anyApproval) {
                            console.log(`[Approvals] Found ${anyApproval.status} approval for document "${document.name}". Creating new pending approval for new version.`);
                        }
                        else {
                            console.log(`[Approvals] Creating initial approval for document "${document.name}" (${document.id})`);
                        }
                        await this.createDocumentApproval({
                            procedureId: procedure.id,
                            documentId: document.id,
                            reviewerId: procedure.reviewerId,
                            responsibleId: procedure.responsibleId || undefined,
                            documentVersionId: latestVersion.id,
                        });
                        syncedCount++;
                    }
                }
            }
            console.log('[Approvals] Sync complete. Created', syncedCount, 'missing approvals');
        }
        catch (err) {
            console.error('[Approvals] Error during sync:', err);
        }
    }
    async getReviewerApprovals(params) {
        const statusMap = {
            pending: 'pending',
            approved: 'approved',
            denied: 'rejected',
        };
        return this.prisma.documentApproval.findMany({
            where: {
                reviewerId: params.reviewerId,
                status: params.status ? statusMap[params.status] : undefined,
            },
            include: {
                procedure: true,
                reviewer: true,
                responsible: true,
            },
            orderBy: { createdAt: 'desc' },
        });
    }
    async approveDocument(params) {
        const approval = await this.prisma.documentApproval.findUnique({
            where: { id: params.approvalId },
            include: {
                procedure: {
                    include: {
                        documents: {
                            include: {
                                versions: {
                                    orderBy: { version: 'desc' },
                                    take: 1,
                                },
                            },
                        },
                    },
                },
                document: {
                    include: {
                        versions: {
                            include: { file: true },
                            orderBy: { uploadDate: 'desc' },
                        },
                    },
                },
            },
        });
        if (!approval) {
            throw new Error('Approval not found');
        }
        const updatedApproval = await this.prisma.documentApproval.update({
            where: { id: params.approvalId },
            data: {
                status: 'approved',
                approvalDate: new Date(),
            },
            include: {
                procedure: true,
                reviewer: true,
                responsible: true,
            },
        });
        const targetVersion = approval.documentVersionId
            ? approval.document?.versions?.find((version) => version.id === approval.documentVersionId)
            : approval.document?.versions?.[0];
        if (approval.documentId && targetVersion?.id) {
            await this.prisma.procedureDocumentVersion.updateMany({
                where: {
                    documentId: approval.documentId,
                    status: { in: ['current', 'expired'] },
                },
                data: { status: 'obsolete' },
            });
            await this.prisma.procedureDocumentVersion.update({
                where: { id: targetVersion.id },
                data: { status: 'current' },
            });
            console.log('[Approvals] Updated document version status to current:', targetVersion.id);
        }
        const approverId = params.user?.sub || params.user?.id;
        if (targetVersion?.fileId && approverId) {
            const approver = await this.prisma.user.findUnique({
                where: { id: approverId },
                select: { firstName: true, lastName: true, signature: true, identityApproved: true },
            });
            const approverName = approver
                ? `${approver.firstName} ${approver.lastName}`.trim()
                : `${params.user?.firstName || ''} ${params.user?.lastName || ''}`.trim() || 'Usuario';
            const responsibleName = updatedApproval.responsible
                ? `${updatedApproval.responsible.firstName} ${updatedApproval.responsible.lastName}`.trim()
                : '';
            const reviewerName = updatedApproval.reviewer
                ? `${updatedApproval.reviewer.firstName} ${updatedApproval.reviewer.lastName}`.trim()
                : '';
            await this.applyApprovalStamp({
                fileId: targetVersion.fileId,
                approvedAt: updatedApproval.approvalDate || new Date(),
                approverName,
                signature: approver?.identityApproved ? approver.signature : null,
                procedureTitle: updatedApproval.procedure?.title,
                procedureResponsibleName: responsibleName,
                procedureReviewerName: reviewerName,
                documentVersion: targetVersion.version || null,
                renewalDate: targetVersion.renewalDate || null,
                userContext: params.user,
            });
        }
        return updatedApproval;
    }
    async rejectDocument(params) {
        const approval = await this.prisma.documentApproval.findUnique({
            where: { id: params.approvalId },
            include: {
                document: {
                    include: {
                        versions: {
                            orderBy: { uploadDate: 'desc' },
                        },
                    },
                },
            },
        });
        if (!approval) {
            throw new Error('Approval not found');
        }
        const updatedApproval = await this.prisma.documentApproval.update({
            where: { id: params.approvalId },
            data: {
                status: 'rejected',
                rejectionReason: params.rejectionReason,
                approvalDate: new Date(),
            },
            include: {
                procedure: true,
                reviewer: true,
                responsible: true,
            },
        });
        const targetVersion = approval.documentVersionId
            ? approval.document?.versions?.find((version) => version.id === approval.documentVersionId)
            : approval.document?.versions?.[0];
        if (approval.documentId && targetVersion?.id) {
            await this.prisma.procedureDocumentVersion.update({
                where: { id: targetVersion.id },
                data: { status: 'inactive' },
            });
            console.log('[Approvals] Updated document version status to inactive:', targetVersion.id);
        }
        else {
            console.warn('[Approvals] Could not resolve target version for rejection:', params.approvalId);
        }
        return updatedApproval;
    }
    async applyApprovalStamp(params) {
        const { fileId, approvedAt, approverName, signature, procedureTitle, procedureResponsibleName, procedureReviewerName, documentVersion, renewalDate, userContext, } = params;
        const { file, stream } = await this.documentsService.getStream(fileId, userContext, 3, { bypassAreaCheck: true });
        if (file.mimeType !== 'application/pdf') {
            console.log('[Approvals] Skipping approval stamp for non-PDF:', fileId);
            return;
        }
        const buffer = await this.streamToBuffer(stream);
        const pdfDoc = await pdf_lib_1.PDFDocument.load(buffer);
        const firstPage = pdfDoc.getPages()[0];
        const { width, height } = firstPage.getSize();
        const coverPage = pdfDoc.insertPage(0, [width, height]);
        const font = await pdfDoc.embedFont(pdf_lib_1.StandardFonts.Helvetica);
        const boldFont = await pdfDoc.embedFont(pdf_lib_1.StandardFonts.HelveticaBold);
        const formattedDate = approvedAt.toLocaleDateString('es-MX', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
        const renewalDateValue = renewalDate && !Number.isNaN(new Date(renewalDate).getTime())
            ? new Date(renewalDate).toLocaleDateString('es-MX', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            })
            : 'N/A';
        const margin = 48;
        const lineHeight = 20;
        let cursorY = height - 80;
        const title = 'APROBADO';
        const titleSize = 34;
        const titleWidth = boldFont.widthOfTextAtSize(title, titleSize);
        coverPage.drawText(title, {
            x: (width - titleWidth) / 2,
            y: cursorY,
            size: titleSize,
            font: boldFont,
            color: (0, pdf_lib_1.rgb)(0.1, 0.5, 0.1),
        });
        cursorY -= 40;
        if (procedureTitle) {
            coverPage.drawText('Procedimiento:', {
                x: margin,
                y: cursorY,
                size: 12,
                font: boldFont,
                color: (0, pdf_lib_1.rgb)(0.2, 0.2, 0.2),
            });
            coverPage.drawText(procedureTitle, {
                x: margin + 110,
                y: cursorY,
                size: 12,
                font,
                color: (0, pdf_lib_1.rgb)(0.2, 0.2, 0.2),
            });
            cursorY -= lineHeight;
        }
        const drawLine = (label, value) => {
            coverPage.drawText(`${label}:`, {
                x: margin,
                y: cursorY,
                size: 11,
                font: boldFont,
                color: (0, pdf_lib_1.rgb)(0.2, 0.2, 0.2),
            });
            coverPage.drawText(value || 'N/A', {
                x: margin + 170,
                y: cursorY,
                size: 11,
                font,
                color: (0, pdf_lib_1.rgb)(0.2, 0.2, 0.2),
            });
            cursorY -= lineHeight;
        };
        drawLine('Supervisor del procedimiento', procedureResponsibleName?.trim() || 'N/A');
        drawLine('Revisor del procedimiento', procedureReviewerName?.trim() || 'N/A');
        drawLine('Aprobado por', approverName || 'Usuario');
        drawLine('Fecha de aprobación', formattedDate);
        drawLine('Versión', documentVersion || 'N/A');
        drawLine('Fecha de renovación', renewalDateValue);
        const signatureBoxHeight = 120;
        const signatureBoxY = margin;
        const signatureBoxWidth = width - margin * 2;
        coverPage.drawRectangle({
            x: margin,
            y: signatureBoxY,
            width: signatureBoxWidth,
            height: signatureBoxHeight,
            borderColor: (0, pdf_lib_1.rgb)(0.1, 0.1, 0.1),
            borderWidth: 1,
            color: (0, pdf_lib_1.rgb)(1, 1, 1),
        });
        coverPage.drawText('Firma de aprobación', {
            x: margin + 12,
            y: signatureBoxY + signatureBoxHeight - 18,
            size: 10,
            font: boldFont,
            color: (0, pdf_lib_1.rgb)(0.2, 0.2, 0.2),
        });
        const signatureData = this.parseSignature(signature);
        if (signatureData) {
            const image = signatureData.mimeType === 'image/jpeg'
                ? await pdfDoc.embedJpg(signatureData.bytes)
                : await pdfDoc.embedPng(signatureData.bytes);
            const maxSigWidth = signatureBoxWidth - 24;
            const maxSigHeight = signatureBoxHeight - 36;
            const scale = Math.min(maxSigWidth / image.width, maxSigHeight / image.height);
            const sigWidth = image.width * scale;
            const sigHeight = image.height * scale;
            const sigX = margin + (signatureBoxWidth - sigWidth) / 2;
            const sigY = signatureBoxY + (signatureBoxHeight - sigHeight) / 2 - 6;
            coverPage.drawImage(image, {
                x: sigX,
                y: sigY,
                width: sigWidth,
                height: sigHeight,
            });
        }
        else {
            coverPage.drawText('Firma no registrada', {
                x: margin + 12,
                y: signatureBoxY + 14,
                size: 9,
                font,
                color: (0, pdf_lib_1.rgb)(0.5, 0.5, 0.5),
            });
        }
        const stampedBytes = await pdfDoc.save();
        await this.documentsService.overwriteFileContent(fileId, Buffer.from(stampedBytes), { mimeType: 'application/pdf' });
    }
    parseSignature(signature) {
        if (!signature)
            return null;
        const dataUrlMatch = signature.match(/^data:(image\/(?:png|jpeg|jpg));base64,(.+)$/i);
        let mimeType = 'image/png';
        let base64 = signature;
        if (dataUrlMatch) {
            mimeType =
                dataUrlMatch[1].toLowerCase() === 'image/jpg'
                    ? 'image/jpeg'
                    : dataUrlMatch[1].toLowerCase();
            base64 = dataUrlMatch[2];
        }
        try {
            const bytes = Buffer.from(base64, 'base64');
            if (!bytes.length)
                return null;
            return { bytes, mimeType };
        }
        catch {
            return null;
        }
    }
    async streamToBuffer(stream) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            stream.on('error', reject);
            stream.on('end', () => resolve(Buffer.concat(chunks)));
        });
    }
    async getApprovalDetails(params) {
        console.log('[Approvals] getApprovalDetails called with:', params);
        const approval = await this.prisma.documentApproval.findUnique({
            where: { id: params.approvalId },
            include: {
                procedure: {
                    include: {
                        documents: {
                            include: {
                                versions: {
                                    orderBy: { version: 'desc' },
                                    include: {
                                        file: true,
                                    },
                                },
                            },
                        },
                    },
                },
                document: {
                    include: {
                        versions: {
                            orderBy: { version: 'desc' },
                            include: {
                                file: true,
                            },
                        },
                    },
                },
                reviewer: true,
                responsible: true,
            },
        });
        if (!approval) {
            console.log('[Approvals] Approval not found:', params.approvalId);
            throw new Error('Approval not found');
        }
        console.log('[Approvals] Found approval:', approval.id, 'Document:', approval.document?.name || 'N/A');
        const latestVersion = approval.document?.versions?.[0];
        const previousVersion = approval.document?.versions?.[1];
        const creator = this.resolveDocumentCreator(approval.document?.versions);
        return {
            id: approval.id,
            status: approval.status,
            createdAt: approval.createdAt,
            updatedAt: approval.updatedAt,
            approvalDate: approval.approvalDate,
            rejectionReason: approval.rejectionReason,
            procedure: {
                id: approval.procedure.id,
                title: approval.procedure.title,
                description: approval.procedure.description,
                documents: approval.procedure.documents,
            },
            document: approval.document,
            currentVersion: latestVersion ? {
                id: latestVersion.id,
                version: latestVersion.version,
                status: latestVersion.status,
                fileId: latestVersion.fileId,
                fileName: latestVersion.file?.originalName || 'Document',
                mimeType: latestVersion.file?.mimeType || 'application/octet-stream',
                file: latestVersion.file,
                uploadDate: latestVersion.uploadDate,
                renewalDate: latestVersion.renewalDate,
                creator,
                updatedBy: latestVersion.updatedBy,
            } : null,
            previousVersion: previousVersion ? {
                id: previousVersion.id,
                version: previousVersion.version,
                status: previousVersion.status,
                fileId: previousVersion.fileId,
                fileName: previousVersion.file?.originalName || 'Document',
                mimeType: previousVersion.file?.mimeType || 'application/octet-stream',
                file: previousVersion.file,
                uploadDate: previousVersion.uploadDate,
                renewalDate: previousVersion.renewalDate,
                creator,
                updatedBy: previousVersion.updatedBy,
            } : null,
            reviewer: approval.reviewer,
            responsible: approval.responsible,
        };
    }
    async listApprovals(params) {
        const { status, category, search, limit = 25, user } = params;
        let userId = user?.id || user?.userId || user?.sub;
        const isDevMode = process.env.NODE_ENV === 'development' || userId === 'local-dev-user';
        await this.syncPendingApprovals();
        if (userId === 'local-dev-user' && user?.email) {
            try {
                const realUser = await this.prisma.user.findFirst({
                    where: { email: user.email }
                });
                if (realUser) {
                    userId = realUser.id;
                    console.log('[Approvals] Mapped stub user to database user:', { stubEmail: user.email, realUserId: userId });
                }
            }
            catch (err) {
                console.log('[Approvals] Could not find user by email:', user.email);
            }
        }
        console.log('[Approvals] listApprovals called with:', { userId, userEmail: user?.email, status, category, search, limit, isDevMode });
        const items = [];
        if (!category || category === 'procedures') {
            const statusMap = {
                pending: 'pending',
                approved: 'approved',
                denied: 'rejected',
            };
            try {
                const whereClause = {
                    status: statusMap[status],
                    documentId: { not: null },
                };
                if (!isDevMode) {
                    whereClause.OR = [
                        { reviewerId: userId },
                        { responsibleId: userId },
                    ];
                }
                if (search) {
                    whereClause.OR = [
                        ...(whereClause.OR || []),
                        { document: { name: { contains: search, mode: 'insensitive' } } },
                        { document: { code: { contains: search, mode: 'insensitive' } } },
                    ];
                }
                console.log('[Approvals] Query where clause:', JSON.stringify(whereClause, null, 2));
                const approvals = await this.prisma.documentApproval.findMany({
                    where: whereClause,
                    include: {
                        procedure: true,
                        document: {
                            include: {
                                versions: {
                                    orderBy: { version: 'desc' },
                                    take: 1,
                                    include: {
                                        file: true,
                                    },
                                },
                            },
                        },
                        reviewer: true,
                        responsible: true,
                    },
                    orderBy: { createdAt: 'desc' },
                    take: limit,
                });
                console.log('[Approvals] Found approvals:', approvals.length, '(isDevMode:', isDevMode, ')');
                for (const approval of approvals) {
                    const latestVersion = approval.document?.versions?.[0];
                    let apiStatus = 'pending';
                    if (approval.status === 'approved') {
                        apiStatus = 'approved';
                    }
                    else if (approval.status === 'rejected') {
                        apiStatus = 'denied';
                    }
                    const latestFile = approval.document?.versions?.[0]?.file;
                    items.push({
                        id: approval.id,
                        code: approval.document?.code,
                        name: approval.document?.name || approval.procedure?.title || 'Documento',
                        category: 'procedures',
                        status: apiStatus,
                        requestedAt: approval.createdAt.toISOString(),
                        updatedAt: approval.updatedAt.toISOString(),
                        reviewer: approval.reviewer ? {
                            id: approval.reviewer.id,
                            name: `${approval.reviewer.firstName} ${approval.reviewer.lastName}`.trim(),
                            email: approval.reviewer.email,
                        } : undefined,
                        responsible: approval.responsible ? {
                            id: approval.responsible.id,
                            name: `${approval.responsible.firstName} ${approval.responsible.lastName}`.trim(),
                            email: approval.responsible.email,
                        } : undefined,
                        procedureTitle: approval.procedure?.title,
                        documentVersion: latestVersion?.version,
                        documentResume: latestFile?.aiResume ?? undefined,
                        aiProcessingStatus: latestFile?.aiProcessingStatus ?? undefined,
                    });
                }
            }
            catch (err) {
                console.error('[Approvals] Error fetching document approvals:', err);
            }
        }
        if (!category || category === 'instructions') {
            const statusMapWi = {
                pending: ['review'],
                approved: ['active'],
                denied: ['obsolete'],
            };
            try {
                const instr = await this.prisma.workInstruction.findMany({
                    where: {
                        status: { in: statusMapWi[status] },
                        ...(search
                            ? {
                                OR: [
                                    { title: { contains: search, mode: 'insensitive' } },
                                    { code: { contains: search, mode: 'insensitive' } },
                                ],
                            }
                            : {}),
                    },
                    orderBy: { updatedAt: 'desc' },
                    take: limit,
                });
                for (const wi of instr) {
                    let apiStatus = 'pending';
                    if (wi.status === 'active') {
                        apiStatus = 'approved';
                    }
                    else if (wi.status === 'obsolete') {
                        apiStatus = 'denied';
                    }
                    items.push({
                        id: wi.id,
                        code: wi.code,
                        name: wi.title,
                        category: 'instructions',
                        status: apiStatus,
                        requestedAt: wi.createdAt?.toISOString?.() ?? undefined,
                        updatedAt: wi.updatedAt?.toISOString?.() ?? undefined,
                    });
                }
            }
            catch (err) {
                console.error('[Approvals] Error fetching work instruction approvals:', err);
            }
        }
        return items;
    }
};
exports.ApprovalsService = ApprovalsService;
exports.ApprovalsService = ApprovalsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        documents_service_1.DocumentsService])
], ApprovalsService);
//# sourceMappingURL=approvals.service.js.map