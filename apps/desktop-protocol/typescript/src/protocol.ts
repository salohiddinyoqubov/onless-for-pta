import { z } from 'zod';

const unsigned32 = z.number().int().min(0).max(4_294_967_295);
const signed32 = z.number().int().min(-2_147_483_648).max(2_147_483_647);
const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
// Rust `Option` accepts an omitted field but serializes its empty value as null.
const nullableString = z.string().nullable().default(null);
const nullableUuid = uuid.nullable().default(null);
const optionalImageField = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? undefined);

export const connectionCodeSchema = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);

export const powerActionSchema = z.enum(['Shutdown', 'Restart', 'Lock', 'ForceClose']);
export const clientStatusSchema = z.enum(['Idle', 'InExam', 'Updating', 'ShuttingDown']);

export const examAnswerPayloadSchema = z
  .object({
    id: uuid,
    text_uz: z.string(),
    text_ru: nullableString,
    text_kaa: nullableString,
    display_order: signed32,
  })
  .strict();

export const examQuestionPayloadSchema = z
  .object({
    id: uuid,
    ticket_id: nullableString,
    ticket_position: signed32.nullable().default(null),
    text_uz: z.string(),
    text_ru: nullableString,
    text_kaa: nullableString,
    difficulty: signed32,
    answers: z.array(examAnswerPayloadSchema),
    image_mime: optionalImageField,
    image_data_base64: optionalImageField,
  })
  .strict()
  .superRefine((question, context) => {
    if ((question.image_mime === undefined) !== (question.image_data_base64 === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'image_mime and image_data_base64 must be provided together',
      });
    }
  });

export const serverToClientSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('ExamStart'),
      session_id: uuid,
      duration_minutes: unsigned32,
      total_questions: unsigned32,
    })
    .strict(),
  z
    .object({
      type: z.literal('ExamQuestion'),
      session_id: uuid,
      index: unsigned32,
      total: unsigned32,
      question: examQuestionPayloadSchema,
    })
    .strict(),
  z.object({ type: z.literal('ExamStop'), reason: z.string() }).strict(),
  z
    .object({
      type: z.literal('AnswerAck'),
      session_id: uuid,
      question_id: uuid,
      selected_answer_id: nullableUuid,
      is_correct: z.boolean(),
      correct_answer_id: uuid,
      error_count: unsigned32,
      auto_failed: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('AnswerError'),
      session_id: uuid,
      question_id: uuid,
      message: z.string(),
    })
    .strict(),
  z.object({ type: z.literal('Ping') }).strict(),
  z
    .object({
      type: z.literal('ConfigUpdate'),
      school_name: nullableString,
      language: nullableString,
    })
    .strict(),
  z
    .object({
      type: z.literal('PowerCommand'),
      action: powerActionSchema,
      delay_secs: unsigned32,
    })
    .strict(),
  z.object({ type: z.literal('ServerShutdown') }).strict(),
]);

export const clientToServerSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('Register'),
      client_id: z.string(),
      client_name: z.string(),
      version: z.string(),
      mac_address: nullableString,
      connection_code: connectionCodeSchema,
    })
    .strict(),
  z.object({ type: z.literal('Pong'), client_id: z.string() }).strict(),
  z
    .object({
      type: z.literal('AnswerSubmit'),
      session_id: uuid,
      question_id: uuid,
      answer_id: nullableUuid,
      time_spent_seconds: unsigned32,
    })
    .strict(),
  z
    .object({
      type: z.literal('ExamComplete'),
      session_id: uuid,
      total_time_seconds: unsigned32,
    })
    .strict(),
  z
    .object({
      type: z.literal('Heartbeat'),
      client_id: z.string(),
      status: clientStatusSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('SubmitStudentInfo'),
      session_id: uuid,
      student_name: z.string(),
    })
    .strict(),
]);

export const wireMessageSchema = z.union([serverToClientSchema, clientToServerSchema]);

export type ConnectionCode = z.infer<typeof connectionCodeSchema>;
export type PowerAction = z.infer<typeof powerActionSchema>;
export type ClientStatus = z.infer<typeof clientStatusSchema>;
export type ExamAnswerPayload = z.infer<typeof examAnswerPayloadSchema>;
export type ExamQuestionPayload = z.infer<typeof examQuestionPayloadSchema>;
export type ServerToClient = z.infer<typeof serverToClientSchema>;
export type ClientToServer = z.infer<typeof clientToServerSchema>;
export type WireMessage = ServerToClient | ClientToServer;

export function parseServerToClient(value: unknown): ServerToClient {
  return serverToClientSchema.parse(value);
}

export function parseClientToServer(value: unknown): ClientToServer {
  return clientToServerSchema.parse(value);
}

export function parseWireMessage(value: unknown): WireMessage {
  return wireMessageSchema.parse(value);
}
