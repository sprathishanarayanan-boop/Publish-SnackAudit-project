const path = require('node:path');
const config=require('./config');
const express = require('express');
const { pool } = require('./db');
const { migrate } = require('./migrate');
const { seed } = require('./seed');
const api = require('./api');

const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'200kb'}));
app.get('/api/health',async(_req,res)=>{
  try { await pool.query('SELECT 1'); res.json({status:'ok',database:'up'}); }
  catch(error) { console.error('[health]',error.message); res.status(503).json({status:'degraded',database:'down'}); }
});
app.use('/api',api);
app.use(express.static(path.join(__dirname,'..','..','client'),{index:'index.html'}));
app.use((req,res,next)=>{
  if(req.path.startsWith('/api/')) return res.status(404).json({error:'API endpoint not found.'});
  next();
});
app.use((error,_req,res,_next)=>{
  const status=error.status||500;
  if(status>=500) console.error(error);
  res.status(status).json({error:status>=500?'The server encountered an error.':error.message,
    ...(error.code?{code:error.code}:{})});
});

async function main(){
  if(!config.databaseUrl) throw new Error('DATABASE_URL is required.');
  if(!config.jwtSecret) throw new Error('JWT_SECRET is required.');
  await migrate();
  if(config.seedDemo) await seed();
  const server=app.listen(config.port,()=>console.log(`OrdertoAudit listening on port ${config.port}`));
  const shutdown=()=>server.close(()=>pool.end().finally(()=>process.exit(0)));
  process.on('SIGINT',shutdown);
  process.on('SIGTERM',shutdown);
}

if(require.main===module) main().catch(async(error)=>{
  console.error('Startup failed:',error);
  await pool.end();
  process.exitCode=1;
});

module.exports={app};
