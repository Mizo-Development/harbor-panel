// Executed as the site's unprivileged Unix account, never as root.
import { listFiles, readContent, writeContent } from './files';
async function main() {
  const [root, action, path] = process.argv.slice(2);
  let output: unknown;
  if (action === 'list') output = await listFiles(root, path);
  else if (action === 'read') output = await readContent(root, path);
  else if (action === 'write') {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk.toString();
      if (input.length > 1048576) throw new Error('File too large');
    }
    output = await writeContent(root, path, input);
  } else throw new Error('Unsupported file operation');
  process.stdout.write(JSON.stringify(output));
}
void main().catch((error) => {
  process.stderr.write(error.message);
  process.exitCode = 1;
});
