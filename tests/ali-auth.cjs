const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { timingSafeEqual } = require('node:crypto');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/api/agent/action/route.ts'),'utf8');
const code = stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm,'').replace('export const runtime', 'const runtime').replace('export async function POST', 'async function POST')) + '\nthis.POST = POST;';
const secret = 'local-test-secret-not-for-deployment-123456';
const cfg = {projectId:'nutri-test',firestoreDatabaseId:'named-test-db'};
let reports=[];
async function test(name,options,status,inspect=()=>{}) {
  const events=[];
  const patient={name:'Paciente Fictício',weight:80,objective:'Teste',targetWeight:75,nutritionistId:'nutritionist-A',...options.patient};
  const ref={ get:async()=>{events.push('read-patient');return {exists:true,data:()=>patient};},update:async(data)=>{events.push('write-patient');events.push(['saved-patient',data]);},collection:()=>({add:async(data)=>{events.push('write-meal');events.push(['saved-meal',data]);}})};
  const db={collection:name=>({doc:uid=>{events.push(['doc',name,uid]);return ref;},add:async(data)=>events.push(['add',name,data])})};
  const env={AGENT_API_SECRET:secret,FIREBASE_SERVICE_ACCOUNT_KEY:JSON.stringify({project_id:cfg.projectId}),...options.env};
  const context=vm.createContext({Buffer,Request,console:{error:()=>{}},Intl,process:{env},timingSafeEqual,firebaseConfig:cfg,
    NextResponse:{json:(body,init={})=>({body,status:init.status||200,headers:init.headers})},
    getApps:()=>[],cert:a=>a,initializeApp:()=>({name:'test'}),
    getAuth:()=>({verifyIdToken:async(token,revocation)=>{
      events.push(['verify',token,revocation]);
      if(options.tokenError) throw new Error('auth/id-token-expired');
      return {uid:'patient-A',firebase:{sign_in_provider:options.anonymous?'anonymous':'password'}};
    }}),
    getFirestore:(app,database)=>{events.push(['database',database]);return db;},
    FieldValue:{arrayUnion:v=>v},
  });
  vm.runInContext(code,context);
  const headers={'x-webhook-secret':secret,'x-patient-token':'test-token',...options.headers};
  Object.keys(headers).forEach(k=>{if(headers[k]===null)delete headers[k];});
  const body=options.rawBody ?? JSON.stringify(options.body ?? {action:'get_patient_data',patientUid:'patient-A'});
  const result=await context.POST(new Request('https://unit.test/api/agent/action',{method:'POST',headers,body}));
  assert.equal(result.status,status,name);
  assert.equal(typeof result.body.ok,'boolean',name);
  assert.equal(typeof result.body.speech,'string',name);
  if(status!==200) assert.ok(!events.some(e=>(typeof e==='string'&&e.startsWith('write')) || (Array.isArray(e)&&e[0]==='add')),name);
  inspect(events,result);
  reports.push('PASS '+name);
}
(async()=>{
  const noDb=ev=>assert.ok(!ev.some(e=>Array.isArray(e)&&e[0]==='database'));
  await test('Sem segredo do servidor: bloqueia', {env:{AGENT_API_SECRET:''}},503,noDb);
  await test('Segredo fraco: bloqueia', {env:{AGENT_API_SECRET:'short'}},503,noDb);
  await test('Segredo de entrada ausente', {headers:{'x-webhook-secret':null}},401,noDb);
  await test('Segredo incorreto', {headers:{'x-webhook-secret':'wrong'}},401,noDb);
  await test('Token ausente', {headers:{'x-patient-token':null}},401,noDb);
  await test('Token excessivo', {headers:{'x-patient-token':'x'.repeat(9000)}},401,noDb);
  await test('Admin não configurado', {env:{FIREBASE_SERVICE_ACCOUNT_KEY:''}},503,noDb);
  await test('Conta Admin de outro projeto', {env:{FIREBASE_SERVICE_ACCOUNT_KEY:'{"project_id":"other"}'}},503,noDb);
  await test('Token rejeitado pelo Firebase', {tokenError:true},401,noDb);
  await test('Conta anônima', {anonymous:true},403,noDb);
  await test('UID de outro paciente', {body:{action:'get_patient_data',patientUid:'patient-B'}},403,noDb);
  await test('JSON inválido', {rawBody:'{'},400,noDb);
  await test('Corpo nulo', {rawBody:'null'},400,noDb);
  await test('Payload inválido', {body:{action:'get_patient_data',payload:[]}},400,noDb);
  await test('Ação fora da allowlist', {body:{action:'delete_patient'}},400,noDb);
  for(const action of ['log_meal','log_measurement','request_appointment']) {
    await test('Exige confirmação: '+action,{body:{action,payload:{}}},422,noDb);
  }
  await test('Consulta usa UID verificado e banco nomeado',{},200,(ev,res)=>{
    assert.ok(ev.some(e=>Array.isArray(e)&&e[0]==='verify'&&e[2]===true));
    assert.ok(ev.some(e=>Array.isArray(e)&&e[0]==='doc'&&e[2]==='patient-A'));
    assert.ok(ev.some(e=>Array.isArray(e)&&e[0]==='database'&&e[1]===cfg.firestoreDatabaseId));
    assert.equal(res.headers['Cache-Control'],'no-store');
  });
  await test('UID omitido usa identidade autenticada',{body:{action:'get_patient_data'}},200);
  await test('Plano rascunho não é revelado', {patient:{currentPlan:{status:'draft',days:[{name:'rascunho secreto',meals:[]}]}}},200,(_,res)=>{
    assert.equal(res.body.approvedPlan,null);
    assert.ok(!JSON.stringify(res.body).includes('rascunho secreto'));
  });
  await test('Plano aprovado retorna refeições', {patient:{currentPlan:{status:'approved',days:[{name:'Segunda',meals:[{name:'Almoço',time:'12:00',items:['Arroz']}]}]}}},200,(_,res)=>{
    assert.equal(res.body.approvedPlan.days[0].meals[0].items[0],'Arroz');
    assert.match(res.body.speech,/Arroz/);
  });
  await test('Não cria pedido sem nutricionista', {patient:{nutritionistId:null},body:{action:'request_appointment',confirmed:true,payload:{preferredDate:'2026-10-01'}}},422);
  await test('Peso e gordura inválidos não gravam',{body:{action:'log_measurement',confirmed:true,payload:{weight:80,bodyFat:101}}},422);
  await test('Peso em array não é convertido em número',{body:{action:'log_measurement',confirmed:true,payload:{weight:[80]}}},400);
  await test('Refeição em objeto não é convertida em texto',{body:{action:'log_meal',confirmed:true,payload:{description:{food:'teste'}}}},422);
  await test('Data em array é rejeitada',{body:{action:'request_appointment',confirmed:true,payload:{preferredDate:['amanhã']}}},422);
  await test('Refeição confirmada passa à persistência simulada',{body:{action:'log_meal',confirmed:true,payload:{description:'Refeição fictícia'}}},200,ev=>{
    assert.equal(ev.find(e=>e[0]==='saved-meal')[1].description,'Refeição fictícia');
    const audit=ev.find(e=>e[0]==='add'&&e[1]==='aiActions')[2];
    assert.equal(audit.result,'completed');
    assert.ok(!('payload' in audit));
  });
  await test('Medição decimal passa à persistência simulada',{body:{action:'log_measurement',confirmed:true,payload:{weight:'80,5'}}},200,ev=>{
    assert.equal(ev.find(e=>e[0]==='saved-patient')[1].weight,80.5);
  });
  await test('Solicitação confirmada permanece pendente',{body:{action:'request_appointment',confirmed:true,payload:{preferredDate:'2026-10-01 14:00'}}},200,ev=>{
    const request=ev.find(e=>e[0]==='add'&&e[1]==='appointmentRequests')[2];
    assert.equal(request.status,'pending');
    assert.equal(request.patientUid,'patient-A');
    assert.equal(request.nutritionistId,'nutritionist-A');
  });
  console.log(reports.join('\n'));
  console.log('Firebase Admin e Firestore simulados; assinatura real e integração entre serviços exigem teste separado.');
  console.log(reports.length+' testes de autenticação passaram.');
})().catch(e=>{console.error(e);process.exitCode=1;});
