/**
 * Seed script for multi-repo project groups.
 *
 * Usage:
 *   npx tsx src/scripts/seedProjectGroups.ts <config.json>
 *
 * Config format:
 * {
 *   "groups": [
 *     {
 *       "group_id": "backend-shared",
 *       "name": "Backend Shared",
 *       "description": "Shared guardrails for all backend services",
 *       "members": ["order-api", "payment-gateway", "inventory-api"]
 *     }
 *   ],
 *   "guardrails": [
 *     {
 *       "group_id": "backend-shared",
 *       "lessons": [
 *         {
 *           "title": "No force push to main",
 *           "content": "Never use git push --force on main/master branch without team approval.",
 *           "tags": ["git", "safety"]
 *         }
 *       ]
 *     }
 *   ]
 * }
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createGroup, addProjectToGroup } from '../services/projectGroups.js';
import { addLesson } from '../services/lessons.js';
import { applyMigrations } from '../db/applyMigrations.js';

interface SeedConfig {
  groups: Array<{
    group_id: string;
    name: string;
    description?: string;
    members: string[];
  }>;
  guardrails?: Array<{
    group_id: string;
    lessons: Array<{
      title: string;
      content: string;
      tags?: string[];
    }>;
  }>;
}

async function main() {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error('Usage: npx tsx src/scripts/seedProjectGroups.ts <config.json>');
    process.exit(1);
  }

  const raw = readFileSync(resolve(configPath), 'utf-8');
  const config: SeedConfig = JSON.parse(raw);

  // Ensure migrations are applied.
  await applyMigrations();

  console.log(`Seeding ${config.groups.length} group(s)...`);

  for (const g of config.groups) {
    console.log(`  Creating group: ${g.group_id} (${g.name})`);
    await createGroup({ group_id: g.group_id, name: g.name, description: g.description });

    for (const member of g.members) {
      console.log(`    Adding member: ${member}`);
      await addProjectToGroup(g.group_id, member);
    }
  }

  if (config.guardrails) {
    console.log(`Seeding guardrails...`);
    for (const gr of config.guardrails) {
      for (const lesson of gr.lessons) {
        console.log(`  Guardrail in ${gr.group_id}: ${lesson.title}`);
        await addLesson({
          project_id: gr.group_id,
          lesson_type: 'guardrail',
          title: lesson.title,
          content: lesson.content,
          tags: lesson.tags ?? [],
          guardrail: {
            trigger: `/.*${lesson.title.toLowerCase().replace(/\s+/g, '.*')}.*/`,
            requirement: lesson.content,
            verification_method: 'user_confirmation',
          },
        });
      }
    }
  }

  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
