const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const workflow = JSON.parse(fs.readFileSync(path.join(__dirname, '../n8n/nutriali-agent-actions.json'), 'utf8'));
const { nodes, connections } = workflow;
const validate = nodes.find(n => n.id === 'ali-validate').parameters.jsCode;
const gate = nodes.find(n => n.id === 'ali-config').parameters.jsCode;
const normalize = nodes.find(n => n.id === 'ali-normalize').parameters.jsCode;
const run=(code,data)=>new Function('$input',code)({first:()=>({json:data})})[0].json;
const make=(action,payload={},extra={})=>({body:{action,patientUid:'paciente-teste',payload,confirmed:true,...extra},headers:{'x-patient-token':'token-ficticio-apenas-validacao-estrutural'}});
let tests=0;
function check(v){assert.ok(v);tests++;}
for(const [a,p] of [['get_patient_data',{}],['log_meal',{description:'Arroz e feijão',mealTime:'almoço'}],['log_measurement',{weight:'82,5',bodyFat:24}],['request_appointment',{preferredDate:'2026-09-21 às 14h'}]]) check(run(validate,make(a,p)).valid);
check(run(validate,make('log_measurement',{weight:'82,5'})).request.payload.weight===82.5);
check(run(validate,make('delete_patient')).status===400);
check(run(validate,make('log_meal',{description:'Almoço'},{confirmed:false})).status===422);
check(run(validate,make('log_meal',{})).status===422);
check(run(validate,make('log_measurement',{weight:Infinity})).status===422);
check(run(validate,make('log_measurement',{weight:82,bodyFat:101})).status===422);
check(run(validate,make('request_appointment',{})).status===422);
check(run(validate,{body:{action:'get_patient_data',patientUid:'../outro'}}).status===400);
check(run(validate,{...make('get_patient_data'),headers:{}}).status===401);
check(run(gate,run(validate,make('get_patient_data'))).status===503);
check(run(normalize,{statusCode:200,body:{message:'Workflow was started'}}).reply.ok===false);
check(run(normalize,{statusCode:200,body:{ok:true,speech:'Registrado'}}).reply.ok===true);
check(run(normalize,{statusCode:401,body:{ok:false,speech:'Não autorizado'}}).status===401);
check(run(normalize,{error:'timeout'}).status===502);
const names=new Set(nodes.map(n=>n.name));
for(const [from,c] of Object.entries(connections)){check(names.has(from));for(const output of c.main)for(const e of output)check(names.has(e.node));}

check(run(validate, make('log_meal', {description:'Teste'})).request.confirmed === true);
check(run(normalize, {statusCode:200,body:{ok:false,speech:'Não gravado'}}).reply.ok === false);
check(run(normalize, {statusCode:503,body:{ok:true,speech:'Inconsistente'}}).reply.ok === false);
check(run(normalize, {statusCode:200,body:{ok:true,speech:'Plano',approvedPlan:{status:'approved'}}}).reply.approvedPlan.status === 'approved');
check(run(normalize, {statusCode:403,body:{ok:false,speech:'Bloqueado',patient:{name:'Outro'}}}).reply.patient === undefined);
check(nodes.find(n => n.id === 'ali-call').retryOnFail === false);
check(workflow.settings.saveDataErrorExecution === 'none' && workflow.settings.saveDataSuccessExecution === 'none');
console.log(tests + ' verificações do contrato n8n passaram. Nenhum serviço externo foi chamado.');
