import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function writeWeeklyGhFixture(
  root: string,
): Promise<{ ghPath: string; providerPath: string }> {
  const providerPath = join(root, "provider.json"),
    ghPath = join(root, "gh.cjs");
  await writeFile(
    providerPath,
    JSON.stringify({
      issues: [],
      comments: [],
      requests: [],
      publisherId: 7,
      repositoryId: 9,
    }),
  );
  const source = String.raw`#!NODE
const fs = require('node:fs');
const p = PROVIDER;
const lock = p+'.lock';
while(true) { try { fs.mkdirSync(lock); break; } catch(e) { if(e.code!=='EEXIST') throw e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2); } }
let state;
try {
state=JSON.parse(fs.readFileSync(p,'utf8'));
const args=process.argv.slice(2), endpoint=args[1], method=args[args.indexOf('--method')+1];
const data=args.includes('--input')?JSON.parse(fs.readFileSync(0,'utf8')):undefined;
state.requests.push({args,data});
const save=()=>fs.writeFileSync(p,JSON.stringify(state));
const issue=(n)=>state.issues.find(i=>i.number===Number(n));
const out=(value)=>process.stdout.write(JSON.stringify(value));
const stamp='2026-10-01T00:00:00Z';
const mutate=method==='POST'||method==='PATCH';
if(mutate && state.inject) {
 const i=state.issues[0];
 if(i) i.body+='\nOWNER-LATE\t\n';
 const c=state.comments.find(c=>c.user.id===99);
 if(c) c.body+='\nOWNER-COMMENT-LATE\t\n';
 state.injected=true; state.inject=false;
}
if(args[0]!=='api') throw Error('forbidden legacy command '+args.join(' '));
if(endpoint==='user') out({id:state.publisherId});
else if(endpoint==='repos/{owner}/{repo}') out({id:state.repositoryId,url:'https://api.github.com/repos/fixture/repo',html_url:'https://github.com/fixture/repo'});
else if(endpoint==='repos/{owner}/{repo}/issues' && method==='POST') {
 if(state.failCreate) { state.failCreate=false; save(); process.exitCode=1; }
 else { const n=Math.max(0,...state.issues.map(i=>i.number))+1;
 const i={id:n+1000,number:n,title:data.title,body:data.body,state:'open',user:{id:state.publisherId},html_url:'https://github.com/fixture/repo/issues/'+n}; state.issues.push(i);out(i);
 if(state.loseCreate) { state.loseCreate=false; process.exitCode=1; } }
}
else if(/issues\/\d+\/comments$/.test(endpoint) && method==='POST') {
 const n=Number(/issues\/(\d+)/.exec(endpoint)[1]);
 const c={id:Math.max(99,...state.comments.map(c=>c.id))+1,body:data.body,user:{id:state.publisherId},issue_url:'https://api.github.com/repos/fixture/repo/issues/'+n,html_url:'https://github.com/fixture/repo/issues/'+n+'#issuecomment-'+(Math.max(99,...state.comments.map(c=>c.id))+1),created_at:stamp,updated_at:stamp};
 if(state.deferComment) { state.deferred=c; state.deferComment=false; process.exitCode=1; }
 else if(state.failComment) { state.failComment=false; process.exitCode=1; }
 else { state.comments.push(c);out(c); if(state.loseComment) { state.loseComment=false; process.exitCode=1; } }
}
else if(/issues\/\d+$/.test(endpoint) && method==='PATCH') {
 if(Object.keys(data).join()!=='state') throw Error('forbidden replacement');
 const i=issue(/issues\/(\d+)/.exec(endpoint)[1]); i.state=data.state;out(i);
 if(state.loseState) { state.loseState=false; process.exitCode=1; }
}
else if(/issues\/comments\/\d+$/.test(endpoint)) out(state.comments.find(c=>c.id===Number(endpoint.split('/').at(-1))));
else if(/issues\/\d+$/.test(endpoint)) out(issue(endpoint.split('/').at(-1)));
else if(args.includes('--include')) {
 const page=Number(new URL('https://api.github.com/'+endpoint).searchParams.get('page'));
 const n=/issues\/(\d+)\/comments/.exec(endpoint)?.[1];
 let records=n?state.comments.filter(c=>c.issue_url.endsWith('/'+n)):state.issues;
 const pages=n?undefined:state.issuePages;
 const values=pages?pages[page-1]??[]:records.slice((page-1)*100,page*100);
 const more=pages?page<pages.length:records.length>page*100;
 let headers='HTTP/2.0 200 OK\r\n';
 if(more) headers+='Link: <https://api.github.com/'+endpoint.replace('repos/{owner}/{repo}','repos/fixture/repo').replace(/page=\d+$/,'page='+(page+1))+'>; rel="next"\r\n';
 if(state.badPage) headers='';
 process.stdout.write(headers+'\r\n'+JSON.stringify(values));
} else throw Error('unhandled '+JSON.stringify(args));
save();
} finally { fs.rmdirSync(lock); }
`;
  await writeFile(
    ghPath,
    source
      .replace("#!NODE", `#!${process.execPath}`)
      .replace("PROVIDER", JSON.stringify(providerPath)),
  );
  await chmod(ghPath, 0o700);
  return { ghPath, providerPath };
}
