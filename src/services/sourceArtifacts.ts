import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getEnv } from '../env.js';

const execFileAsync = promisify(execFile);

type SourceStorageMode = 'local' | 's3' | 'hybrid';

function shouldUseS3(mode: SourceStorageMode) {
  return mode === 's3' || mode === 'hybrid';
}

function keyPrefix(projectId: string, ref: string) {
  const safeProject = projectId.replace(/[^\w./-]+/g, '_');
  const safeRef = ref.replace(/[^\w./-]+/g, '_');
  return `source-artifacts/${safeProject}/${safeRef}`;
}

function toStreamBuffer(body: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    body.on('data', (chunk: any) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    body.on('end', () => resolve(Buffer.concat(chunks)));
    body.on('error', reject);
  });
}

function buildS3Client() {
  const env = getEnv();
  if (!env.S3_ENDPOINT || !env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) return null;
  return new S3Client({
    region: env.S3_REGION ?? 'us-east-1',
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
}

async function ensureBucket(s3: S3Client, bucket: string) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

async function bundleRepo(repoRoot: string): Promise<string> {
  const tmpDir = path.join(repoRoot, '.contexthub', 'artifacts');
  await fs.mkdir(tmpDir, { recursive: true });
  const bundlePath = path.join(tmpDir, `repo-${Date.now()}-${randomUUID()}.bundle`);
  await execFileAsync('git', ['-C', repoRoot, 'bundle', 'create', bundlePath, '--all'], { maxBuffer: 16 * 1024 * 1024 });
  return bundlePath;
}

export async function syncSourceArtifactToS3(params: {
  projectId: string;
  ref: string;
  commitSha: string;
  repoRoot: string;
  mode: SourceStorageMode;
}): Promise<{ uploaded: boolean; artifact_key?: string; metadata_key?: string; warning?: string }> {
  if (!shouldUseS3(params.mode)) return { uploaded: false, warning: 'SOURCE_STORAGE_MODE does not require S3 sync.' };
  const env = getEnv();
  const s3 = buildS3Client();
  if (!s3 || !env.S3_BUCKET) {
    return { uploaded: false, warning: 'S3 is not fully configured (endpoint/bucket/credentials missing).' };
  }

  const prefix = keyPrefix(params.projectId, params.ref);
  const artifactKey = `${prefix}/repo.bundle`;
  const metadataKey = `${prefix}/latest.json`;
  const bundlePath = await bundleRepo(params.repoRoot);
  try {
    await ensureBucket(s3, env.S3_BUCKET);
    const body = await fs.readFile(bundlePath);
    await s3.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: artifactKey,
        Body: body,
        ContentType: 'application/octet-stream',
      }),
    );
    await s3.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: metadataKey,
        Body: JSON.stringify(
          {
            project_id: params.projectId,
            ref: params.ref,
            commit_sha: params.commitSha,
            artifact_key: artifactKey,
            synced_at: new Date().toISOString(),
          },
          null,
          2,
        ),
        ContentType: 'application/json',
      }),
    );
    return { uploaded: true, artifact_key: artifactKey, metadata_key: metadataKey };
  } finally {
    await fs.unlink(bundlePath).catch(() => {});
  }
}

export async function materializeRepoFromS3(params: {
  projectId: string;
  ref: string;
  repoRoot: string;
  mode: SourceStorageMode;
}): Promise<{ restored: boolean; warning?: string }> {
  if (!shouldUseS3(params.mode)) return { restored: false, warning: 'SOURCE_STORAGE_MODE does not require S3 restore.' };
  const env = getEnv();
  const s3 = buildS3Client();
  if (!s3 || !env.S3_BUCKET) {
    return { restored: false, warning: 'S3 is not fully configured (endpoint/bucket/credentials missing).' };
  }

  const prefix = keyPrefix(params.projectId, params.ref);
  const artifactKey = `${prefix}/repo.bundle`;
  try {
    await ensureBucket(s3, env.S3_BUCKET);
    const obj = await s3.send(
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: artifactKey,
      }),
    );
    const stream = obj.Body as any;
    if (!stream) return { restored: false, warning: 'S3 object body empty.' };
    const bundle = await toStreamBuffer(stream);
    const parent = path.dirname(params.repoRoot);
    await fs.mkdir(parent, { recursive: true });
    const tmpBundle = path.join(parent, `.restore-${Date.now()}-${randomUUID()}.bundle`);
    await fs.writeFile(tmpBundle, bundle);
    try {
      await execFileAsync('git', ['clone', tmpBundle, params.repoRoot], { maxBuffer: 16 * 1024 * 1024 });
      await execFileAsync('git', ['-C', params.repoRoot, 'checkout', params.ref], { maxBuffer: 16 * 1024 * 1024 }).catch(() => {});
      return { restored: true };
    } finally {
      await fs.unlink(tmpBundle).catch(() => {});
    }
  } catch {
    return { restored: false, warning: `No S3 artifact found at key ${artifactKey}` };
  }
}

