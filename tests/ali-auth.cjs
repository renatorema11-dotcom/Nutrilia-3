const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { timingSafeEqual } = require('node:crypto');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/api/agent/action/route.ts'),'utf8');
const code = stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm,'').replace('export const runtime', 'const runtime').replace('export async function POST', 'async function POST')) + '\nthis.POST = POST;';
// Regras reais de água e humor (lib/daily-log.ts), carregadas sem as importações.
const dailyLog = vm.runInContext('({ WATER_GOAL_ML, WATER_MAX_ML, MOOD_LABELS, isMood, dailyKey, isSameDay, waterToday, moodToday })',
  require('./fakes.cjs').loadLib(['agenda.ts', 'daily-log.ts'], {}));
const secret = 'local-test-secret-not-for-deployment-123456';
const cfg = {projectId:'nutri-test',firestoreDatabaseId:'named-test-db'};
let reports=[];
async function test(name,options,status,inspect=()=>{}) {
  const events=[];
  const patient={name:'Paciente Fictício',weight:80,objective:'Teste',targetWeight:75,nutritionistId:'nutritionist-A',...options.patient};
  const ref={ get:async()=>{events.push('read-patient');return {exists:true,data:()=>patient};},update:async(data)=>{events.push('write-patient');events.push(['saved-patient',data]);},collection:()=>({add:async(data)=>{events.push('write-meal');events.push(['saved-meal',data]);}})};
  // Perfil do paciente (users/{uid}): onde a tela e a Ali guardam a água e o humor do dia.
  const userRef={ get:async()=>{events.push('read-user');return {exists:true,data:()=>options.profile||{}};},set:async(data,opts)=>{events.push('write-user');events.push(['saved-user',data,opts]);}};
  const db={collection:name=>({doc:uid=>{events.push(['doc',name,uid]);return name==='users'?userRef:ref;},add:async(data)=>events.push(['add',name,data])})};
  const env={AGENT_API_SECRET:secret,FIREBASE_SERVICE_ACCOUNT_KEY:JSON.stringify({project_id:cfg.projectId}),...options.env};
  // Integração Google simulada: registra as chamadas e devolve respostas fixas.
  const workspace={
    isValidEmail:v=>typeof v==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    notifyAppointmentRequest:async (db,input)=>{events.push(['notify',input]);},
    findFreeSlots:async (db,nutritionistId,filters)=>{events.push(['slots',nutritionistId,filters]);return {ok:true,speech:'Tenho terça às 14h.',slots:[{start:'2026-10-13T14:00:00-03:00',label:'terça'}],mode:'online'};},
    bookAppointment:async (db,input)=>{events.push(['book',input]);return {ok:true,speech:'Consulta marcada.',appointment:{label:'terça',start:input.start,mode:'online'}};},
    sendPlanEmail:async (db,input)=>{events.push(['plan-mail',input]);return {ok:true,speech:'Plano enviado.'};},
    ...options.workspace,
  };
  // Cancelar e remarcar simulados: registram as chamadas e devolvem respostas fixas.
  const appointments={
    cancelNextAppointment:async (db,uid)=>{events.push(['cancel',uid]);return {ok:true,speech:'Consulta cancelada.',appointment:{label:'terça',status:'cancelled'}};},
    rescheduleNextAppointment:async (db,uid,start)=>{events.push(['reschedule',uid,start]);return {ok:true,speech:'Consulta remarcada.',appointment:{label:'quarta',start,mode:'online'}};},
    ...options.appointments,
  };
  const context=vm.createContext({Buffer,Request,console:{error:()=>{}},Intl,process:{env},timingSafeEqual,firebaseConfig:cfg,workspace,appointments,dailyLog,
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
  for(const action of ['log_meal','log_measurement','request_appointment','book_appointment','send_plan_email','cancel_appointment','reschedule_appointment','log_water','log_mood']) {
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
    assert.equal(ev.find(e=>e[0]==='notify')[1].nutritionistId,'nutritionist-A');
  });
  await test('Horários livres não exigem confirmação e usam a nutricionista do paciente',{body:{action:'get_free_slots',payload:{period:'tarde'}}},200,(ev,res)=>{
    const call=ev.find(e=>e[0]==='slots');
    assert.equal(call[1],'nutritionist-A');
    assert.equal(call[2].period,'tarde');
    assert.equal(res.body.slots[0].start,'2026-10-13T14:00:00-03:00');
  });
  await test('Horários livres sem nutricionista vinculada',{patient:{nutritionistId:null},body:{action:'get_free_slots'}},422);
  await test('Marcar consulta exige horário em texto',{body:{action:'book_appointment',confirmed:true,payload:{start:['2026-10-13T14:00:00-03:00']}}},422);
  await test('Marcar consulta usa e-mail do prontuário, nunca o do pedido',{patient:{email:'paciente@exemplo.com'},body:{action:'book_appointment',confirmed:true,payload:{start:'2026-10-13T14:00:00-03:00',email:'outra@pessoa.com'}}},200,(ev,res)=>{
    const call=ev.find(e=>e[0]==='book')[1];
    assert.equal(call.patientEmail,'paciente@exemplo.com');
    assert.equal(call.nutritionistId,'nutritionist-A');
    assert.equal(call.patientUid,'patient-A');
    assert.equal(res.body.appointment.start,'2026-10-13T14:00:00-03:00');
  });
  await test('Recusa da agenda chega à Ali com o status certo',{workspace:{bookAppointment:async()=>({ok:false,status:409,speech:'Horário ocupado.'})},body:{action:'book_appointment',confirmed:true,payload:{start:'2026-10-13T14:00:00-03:00'}}},409,(_,res)=>{
    assert.equal(res.body.speech,'Horário ocupado.');
  });
  await test('Plano por e-mail só leva o plano aprovado',{patient:{email:'paciente@exemplo.com',currentPlan:{status:'approved',days:[{name:'Segunda',meals:[{name:'Almoço',time:'12:00',items:['Arroz']}]}]}},body:{action:'send_plan_email',confirmed:true}},200,ev=>{
    const call=ev.find(e=>e[0]==='plan-mail')[1];
    assert.equal(call.days[0].meals[0].items[0],'Arroz');
    assert.equal(call.patientEmail,'paciente@exemplo.com');
  });
  await test('Rascunho não vai por e-mail',{patient:{currentPlan:{status:'draft',days:[{name:'rascunho secreto',meals:[]}]}},body:{action:'send_plan_email',confirmed:true}},200,ev=>{
    assert.equal(ev.find(e=>e[0]==='plan-mail')[1].days.length,0);
  });
  await test('Cancelar consulta vale só para o paciente autenticado',{body:{action:'cancel_appointment',confirmed:true,payload:{patientUid:'patient-B'}}},200,(ev,res)=>{
    assert.equal(ev.find(e=>e[0]==='cancel')[1],'patient-A');
    assert.equal(res.body.appointment.status,'cancelled');
  });
  await test('Sem consulta para cancelar chega à Ali com o status certo',{appointments:{cancelNextAppointment:async()=>({ok:false,status:409,speech:'Não encontrei consulta.'})},body:{action:'cancel_appointment',confirmed:true}},409,(_,res)=>{
    assert.equal(res.body.speech,'Não encontrei consulta.');
  });
  await test('Remarcar consulta exige horário em texto',{body:{action:'reschedule_appointment',confirmed:true,payload:{start:5}}},422);
  await test('Remarcar consulta repassa o horário escolhido',{body:{action:'reschedule_appointment',confirmed:true,payload:{start:'2026-10-14T14:00:00-03:00'}}},200,(ev,res)=>{
    const call=ev.find(e=>e[0]==='reschedule');
    assert.equal(call[1],'patient-A');
    assert.equal(call[2],'2026-10-14T14:00:00-03:00');
    assert.equal(res.body.appointment.start,'2026-10-14T14:00:00-03:00');
  });
  // Água e humor por voz: gravam no perfil do paciente, no mesmo formato da tela inicial.
  const today=dailyLog.dailyKey();
  const [year,month,day]=today.split('-');
  const savedUser=ev=>ev.find(e=>e[0]==='saved-user');
  // Os objetos gravados nascem em outro contexto de execução: compara pelo conteúdo.
  const same=(actual,expected)=>assert.equal(JSON.stringify(actual),JSON.stringify(expected));
  await test('Água soma ao que já foi bebido hoje e grava no perfil do paciente autenticado',{profile:{waterIntake:{amount:500,date:today}},body:{action:'log_water',confirmed:true,payload:{amountMl:250}}},200,(ev,res)=>{
    same(savedUser(ev)[1],{waterIntake:{amount:750,date:today}});
    same(savedUser(ev)[2],{merge:true});
    assert.ok(ev.some(e=>Array.isArray(e)&&e[0]==='doc'&&e[1]==='users'&&e[2]==='patient-A'));
    assert.match(res.body.speech,/Mais 250 ml de água\. Hoje você já bebeu 750 ml\. Faltam 1250 ml para a meta de 2000 ml\./);
    const audit=ev.find(e=>e[0]==='add'&&e[1]==='aiActions')[2];
    assert.equal(audit.action,'log_water');
    assert.ok(!('amountMl' in audit));
  });
  await test('Água marcada na tela antiga (data no formato do navegador) continua valendo',{profile:{waterIntake:{amount:1000,date:`${day}/${month}/${year}`}},body:{action:'log_water',confirmed:true,payload:{amountMl:'500'}}},200,ev=>{
    assert.equal(savedUser(ev)[1].waterIntake.amount,1500);
  });
  await test('Água de outro dia não entra na conta de hoje',{profile:{waterIntake:{amount:1800,date:'2020-01-01'}},body:{action:'log_water',confirmed:true,payload:{amountMl:300}}},200,(ev,res)=>{
    assert.equal(savedUser(ev)[1].waterIntake.amount,300);
    assert.match(res.body.speech,/Faltam 1700 ml/);
  });
  await test('Total do dia dito pelo paciente substitui a soma e pode corrigir para menos',{profile:{waterIntake:{amount:1800,date:today}},body:{action:'log_water',confirmed:true,payload:{amountMl:1000,setTotal:true}}},200,(ev,res)=>{
    assert.equal(savedUser(ev)[1].waterIntake.amount,1000);
    assert.match(res.body.speech,/Deixei anotado 1000 ml de água hoje\. Faltam 1000 ml/);
  });
  await test('Água: bater a meta e teto diário',{profile:{waterIntake:{amount:5900,date:today}},body:{action:'log_water',confirmed:true,payload:{amountMl:500}}},200,(ev,res)=>{
    assert.equal(savedUser(ev)[1].waterIntake.amount,6000);
    assert.match(res.body.speech,/Você bateu a meta/);
  });
  for(const payload of [{},{amountMl:'bastante'},{amountMl:10},{amountMl:5000},{amountMl:[250]},{amountMl:7000,setTotal:true},{amountMl:-1,setTotal:true}]) {
    await test('Água inválida não grava: '+JSON.stringify(payload),{body:{action:'log_water',confirmed:true,payload}},422);
  }
  await test('Humor grava no perfil, só com um dos quatro valores da tela',{body:{action:'log_mood',confirmed:true,payload:{mood:'happy',patientUid:'patient-B'}}},200,(ev,res)=>{
    same(savedUser(ev)[1],{moodDiary:{mood:'happy',date:today}});
    assert.match(res.body.speech,/se sentindo feliz/);
  });
  await test('Humor triste recebe acolhimento e oferta de falar com a nutricionista',{body:{action:'log_mood',confirmed:true,payload:{mood:'sad'}}},200,(_,res)=>{
    assert.match(res.body.speech,/Sinto muito/);
    assert.match(res.body.speech,/nutricionista/);
  });
  for(const mood of ['angry','',null,['happy'],'constructor']) {
    await test('Humor inválido não grava: '+JSON.stringify(mood),{body:{action:'log_mood',confirmed:true,payload:{mood}}},422);
  }
  await test('Dados do paciente contam a água e o humor de hoje',{profile:{waterIntake:{amount:500,date:today},moodDiary:{mood:'great',date:today}}},200,(_,res)=>{
    assert.match(res.body.speech,/Água de hoje: 500 ml de 2000 ml\. Humor de hoje: ótimo\./);
  });
  await test('Sem registro de hoje, os dados dizem que ainda não há',{profile:{waterIntake:{amount:900,date:'2020-01-01'},moodDiary:{mood:'sad',date:'2020-01-01'}}},200,(_,res)=>{
    assert.match(res.body.speech,/Água de hoje: 0 ml de 2000 ml\. Humor de hoje: ainda não registrado\./);
  });
  console.log(reports.join('\n'));
  console.log('Firebase Admin e Firestore simulados; assinatura real e integração entre serviços exigem teste separado.');
  console.log(reports.length+' testes de autenticação passaram.');
})().catch(e=>{console.error(e);process.exitCode=1;});
