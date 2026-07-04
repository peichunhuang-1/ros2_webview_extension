import { execFile } from 'child_process';

// --- Live ROS2 graph introspection -------------------------------------
// Unlike schemaGen.ts (which reads installed .msg/.srv/.action *definitions*
// from AMENT_PREFIX_PATH), this reflects what is actually running right now,
// via the `ros2 <kind> list -t` CLI (requires a sourced ROS2 environment).

export interface GraphEntry {
  name:  string;
  types: string[];
}

export interface GraphList {
  topics:   GraphEntry[];
  services: GraphEntry[];
  actions:  GraphEntry[];
}

function parseListOutput(stdout: string): GraphEntry[] {
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const match = line.match(/^(\S+)\s+\[(.+)\]$/);
      if (!match) { return { name: line, types: [] }; }
      return { name: match[1], types: match[2].split(',').map(t => t.trim()) };
    });
}

function runListOnce(kind: 'topic' | 'service' | 'action'): Promise<GraphEntry[]> {
  return new Promise((resolve, reject) => {
    execFile('ros2', [kind, 'list', '-t'], { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) { reject(new Error(stderr.trim() || err.message)); return; }
      resolve(parseListOutput(stdout));
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// `ros2 <kind> list` occasionally fails with a spurious "invalid choice" argparse
// error when ros2cli's verb-plugin discovery races against a concurrent colcon
// build rewriting the install tree. A short-delay retry clears this in practice.
async function runList(kind: 'topic' | 'service' | 'action'): Promise<GraphEntry[]> {
  try {
    return await runListOnce(kind);
  } catch {
    await delay(300);
    return runListOnce(kind);
  }
}

export async function listGraph(): Promise<GraphList> {
  const [topics, services, actions] = await Promise.allSettled([
    runList('topic'),
    runList('service'),
    runList('action'),
  ]);
  return {
    topics:   topics.status   === 'fulfilled' ? topics.value   : [],
    services: services.status === 'fulfilled' ? services.value : [],
    actions:  actions.status  === 'fulfilled' ? actions.value  : [],
  };
}
