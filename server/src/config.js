const fs=require('node:fs');
const path=require('node:path');

const envFile=path.join(__dirname,'..','..','.env');
if(fs.existsSync(envFile)){
  for(const line of fs.readFileSync(envFile,'utf8').split(/\r?\n/)){
    const match=/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if(match&&!line.trim().startsWith('#')&&process.env[match[1]]===undefined){
      process.env[match[1]]=match[2].replace(/^(['"])(.*)\1$/,'$2');
    }
  }
}

module.exports={
  port:Number(process.env.PORT||4000),
  databaseUrl:process.env.DATABASE_URL,
  jwtSecret:process.env.JWT_SECRET,
  factoryState:process.env.FACTORY_STATE||'Tamil Nadu',
  factoryGstin:process.env.FACTORY_GSTIN||'33AABCU9603R1ZM',
  seedDemo:process.env.SEED_DEMO!=='false',
};
