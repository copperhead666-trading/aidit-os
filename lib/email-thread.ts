import { z } from 'zod';
import type { MessageStructureObject } from 'imapflow';

export const EmailAttachmentSchema = z.object({
  part: z.string().min(1),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  size: z.number().int().nonnegative(),
});

export const EmailThreadMessageSchema = z.object({
  uid: z.number().int().positive(),
  emailId: z.string().optional(),
  messageId: z.string().optional(),
  from: z.string(),
  fromAddress: z.string().optional(),
  to: z.array(z.string()),
  cc: z.array(z.string()),
  sentByMe: z.boolean(),
  subject: z.string(),
  date: z.string().datetime(),
  body: z.string(),
  unread: z.boolean(),
  starred: z.boolean(),
  attachments: z.array(EmailAttachmentSchema),
});

export const EmailThreadSchema = z.object({
  account: z.string().min(1),
  threadId: z.string().min(1),
  subject: z.string(),
  replyTo: z.string().email().optional(),
  messages: z.array(EmailThreadMessageSchema),
});

export type EmailAttachment = z.infer<typeof EmailAttachmentSchema>;
export type EmailThreadMessage = z.infer<typeof EmailThreadMessageSchema>;
export type EmailThread = z.infer<typeof EmailThreadSchema>;

export const EmailInboxItemSchema = z.object({
  id: z.string().min(1),
  sender: z.string(),
  subject: z.string(),
  preview: z.string(),
  ts: z.string().datetime(),
  unread: z.number().int().nonnegative(),
  replyTo: z.string().optional(),
  emailUid: z.number().int().positive(),
  emailThreadId: z.string().optional(),
  emailMessageId: z.string().optional(),
  starred: z.boolean(),
});

export type EmailInboxItem = z.infer<typeof EmailInboxItemSchema>;

export function replySubject(subject: string): string {
  const clean = subject.trim() || '(no subject)';
  return /^re\s*:/i.test(clean) ? clean : `Re: ${clean}`;
}

export function threadReferences(references: string[], parent?: string): string[] {
  return [...new Set([...references, ...(parent ? [parent] : [])].map((value) => value.trim()).filter(Boolean))];
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const codePoint = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

/** Convert HTML mail to safe text. The UI never inserts remote HTML. */
export function htmlEmailToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|blockquote|h[1-6]|tr)>/gi, '\n\n')
      .replace(/<li[^>]*>/gi, '* ')
      .replace(/<[^>]+>/g, '')
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  );
}

type ReadablePart = { part: string; html: boolean };

export function selectReadablePart(structure?: MessageStructureObject): ReadablePart | undefined {
  if (!structure) return undefined;
  const nodes: MessageStructureObject[] = [];
  const visit = (node: MessageStructureObject) => {
    nodes.push(node);
    node.childNodes?.forEach(visit);
  };
  visit(structure);
  const plain = nodes.find((node) => node.part && node.type.toLowerCase() === 'text/plain' && node.disposition !== 'attachment');
  if (plain?.part) return { part: plain.part, html: false };
  const html = nodes.find((node) => node.part && node.type.toLowerCase() === 'text/html' && node.disposition !== 'attachment');
  return html?.part ? { part: html.part, html: true } : undefined;
}

export function findEmailAttachments(structure?: MessageStructureObject): EmailAttachment[] {
  if (!structure) return [];
  const attachments: EmailAttachment[] = [];
  const visit = (node: MessageStructureObject) => {
    const filename = node.dispositionParameters?.filename ?? node.parameters?.name;
    if (node.part && filename && (node.disposition === 'attachment' || !node.type.toLowerCase().startsWith('text/'))) {
      attachments.push({
        part: node.part,
        filename,
        contentType: node.type || 'application/octet-stream',
        size: node.size ?? 0,
      });
    }
    node.childNodes?.forEach(visit);
  };
  visit(structure);
  return attachments;
}
