import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_COUNT, ATTACHMENT_TYPES, ComplaintAttachment } from './complaints.models';

/**
 * Reads picked files into attachments (data URLs in this UI-only build).
 * Returns the accepted files plus a message for any that were rejected.
 */
export async function readAttachments(
  files: FileList | null,
  alreadyAttached: number,
): Promise<{ added: ComplaintAttachment[]; error: string }> {
  const list = Array.from(files ?? []);
  const errors: string[] = [];
  const room = Math.max(0, ATTACHMENT_MAX_COUNT - alreadyAttached);
  if (list.length > room) errors.push(`Up to ${ATTACHMENT_MAX_COUNT} files per entry.`);

  const accepted = list.slice(0, room).filter((f) => {
    if (!ATTACHMENT_TYPES.includes(f.type)) {
      errors.push(`${f.name}: use JPG, PNG, WebP or PDF.`);
      return false;
    }
    if (f.size > ATTACHMENT_MAX_BYTES) {
      errors.push(`${f.name}: larger than 2 MB.`);
      return false;
    }
    return true;
  });

  const added = await Promise.all(
    accepted.map(
      (f, i) =>
        new Promise<ComplaintAttachment>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ id: `ATT-${Date.now()}-${i}`, name: f.name, type: f.type, url: reader.result as string });
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(f);
        }),
    ),
  );
  return { added, error: errors.join(' ') };
}

export const isImage = (a: ComplaintAttachment): boolean => a.type.startsWith('image/');
