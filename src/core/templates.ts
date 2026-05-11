import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface InitOptions {
  workspace: string;
  force?: boolean;
}

export interface InitResult {
  created: string[];
  skipped: string[];
}

export function initWorkspace(options: InitOptions): InitResult {
  const workspace = path.resolve(options.workspace);
  const templateRoot = findTemplateRoot();
  const files = walk(templateRoot);
  const created: string[] = [];
  const skipped: string[] = [];

  for (const source of files) {
    const relative = path.relative(templateRoot, source).replaceAll("\\", "/");
    const destination = path.join(workspace, relative);
    if (fs.existsSync(destination) && !options.force) {
      skipped.push(relative);
      continue;
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    created.push(relative);
  }

  return { created, skipped };
}

function findTemplateRoot(): string {
  const current = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(current, "../../templates"),
    path.resolve(current, "../templates"),
    path.resolve(process.cwd(), "templates")
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error("Could not locate templates directory.");
  }
  return found;
}

function walk(directory: string): string[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

