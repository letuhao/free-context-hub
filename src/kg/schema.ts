import type { Session } from 'neo4j-driver';

export async function ensureKgSchema(session: Session): Promise<void> {
  const statements = [
    `CREATE CONSTRAINT project_project_id_unique IF NOT EXISTS
     FOR (p:Project) REQUIRE p.project_id IS UNIQUE;`,
    `CREATE CONSTRAINT file_file_id_unique IF NOT EXISTS
     FOR (f:File) REQUIRE f.file_id IS UNIQUE;`,
    `CREATE CONSTRAINT symbol_symbol_id_unique IF NOT EXISTS
     FOR (s:Symbol) REQUIRE s.symbol_id IS UNIQUE;`,
    `CREATE CONSTRAINT lesson_lesson_id_unique IF NOT EXISTS
     FOR (l:Lesson) REQUIRE l.lesson_id IS UNIQUE;`,
  ];

  await session.executeWrite(tx => {
    return Promise.all(statements.map(cypher => tx.run(cypher)));
  });
}
