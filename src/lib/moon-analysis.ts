import { z } from "zod";

export const moonAnalysisScopeSchema = z.enum(["video", "weekly", "monthly"]);

export const moonAnalysisStatusSchema = z.enum([
  "pending",
  "queued",
  "running",
  "complete",
  "failed",
  "needs_review",
]);

export const moonAnalysisRequestSchema = z
  .object({
    scopeType: moonAnalysisScopeSchema,
    youtubeVideoId: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9_-]{11}$/)
      .optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes: z.string().trim().max(4000).optional().default(""),
    forceRefresh: z.boolean().optional().default(false),
  })
  .superRefine((value, context) => {
    if (value.scopeType === "video" && !value.youtubeVideoId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["youtubeVideoId"],
        message: "A YouTube video id is required for video analysis runs.",
      });
    }
  });

const reportCardSchema = z.object({
  label: z.string(),
  value: z.string(),
  note: z.string(),
});

const reportRowSchema = z.object({
  youtubeVideoId: z.string(),
  title: z.string(),
  viewsLabel: z.string(),
  avgViewPctLabel: z.string(),
  netSubscribersLabel: z.string(),
  watchHoursLabel: z.string(),
  verdict: z.string(),
});

const reportSectionSchema = z.object({
  heading: z.string(),
  body: z.string(),
});

const reportIdeaSchema = z.object({
  title: z.string(),
  whyNow: z.string(),
  evidence: z.string(),
});

const reportOutlierSchema = z.object({
  title: z.string(),
  channel: z.string().optional().default("Moon"),
  value: z.string(),
  note: z.string(),
});

export const moonAnalysisReportSchema = z.object({
  title: z.string(),
  dek: z.string(),
  scopeLabel: z.string(),
  windowLabel: z.string(),
  summary: z.string(),
  pills: z.array(z.string()).max(8).default([]),
  keyTakeaways: z.array(z.string()).min(3).max(8),
  numbersThatMatter: z.array(reportCardSchema).min(3).max(8),
  cohortRows: z.array(reportRowSchema).min(1).max(20),
  transcriptFindings: z.array(reportSectionSchema).min(2).max(8),
  retentionFindings: z.array(reportSectionSchema).min(2).max(8),
  targetDiagnosis: z
    .object({
      title: z.string(),
      summary: z.string(),
      bullets: z.array(z.string()).min(2).max(8),
    })
    .nullable(),
  winnerPatterns: z.array(reportSectionSchema).min(2).max(8),
  historicalOutliers: z.array(reportOutlierSchema).min(3).max(12),
  externalSignals: z.array(reportOutlierSchema).max(12).default([]),
  ideaDirections: z.array(reportIdeaSchema).min(4).max(12),
  footerNote: z.string(),
});

export const moonAnalysisRunSchema = z.object({
  id: z.string().uuid(),
  status: moonAnalysisStatusSchema,
  scopeType: moonAnalysisScopeSchema,
  scopeStartDate: z.string(),
  scopeEndDate: z.string(),
  youtubeVideoId: z.string().nullable(),
  youtubeVideoTitle: z.string().nullable(),
  label: z.string().nullable(),
  request: moonAnalysisRequestSchema,
  result: moonAnalysisReportSchema.nullable(),
  reportHtml: z.string().nullable(),
  artifactDir: z.string().nullable(),
  errorText: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type MoonAnalysisScope = z.infer<typeof moonAnalysisScopeSchema>;
export type MoonAnalysisStatus = z.infer<typeof moonAnalysisStatusSchema>;
export type MoonAnalysisRequest = z.infer<typeof moonAnalysisRequestSchema>;
export type MoonAnalysisReport = z.infer<typeof moonAnalysisReportSchema>;
export type MoonAnalysisRun = z.infer<typeof moonAnalysisRunSchema>;
