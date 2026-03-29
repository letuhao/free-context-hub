import * as z from 'zod/v4';

export const OutputFormatSchema = z.enum(['auto_both', 'json_only', 'json_pretty', 'summary_only']);
export type OutputFormat = z.infer<typeof OutputFormatSchema>;

export function formatToolResponse<T>(
  result: T,
  summary: string,
  output_format: OutputFormat,
) {
  const jsonMin = JSON.stringify(result);
  const jsonPretty = JSON.stringify(result, null, 2);

  let text: string;
  switch (output_format) {
    case 'json_only':
      text = jsonMin;
      break;
    case 'json_pretty':
      text = jsonPretty;
      break;
    case 'summary_only':
      text = summary;
      break;
    case 'auto_both':
    default:
      text = `${summary}\n${jsonMin}`;
      break;
  }

  return {
    content: [{ type: 'text' as const, text }],
    structuredContent: result,
  };
}
