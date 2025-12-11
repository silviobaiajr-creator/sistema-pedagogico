
// =================================================================================
// ARQUIVO: reports.js
// VERSÃO: 10.5 (Dados Completos + Foto Grande + Atualização Instantânea)
// =================================================================================

import { state, dom } from './state.js';
import { formatDate, formatTime, formatText, showToast, openModal, closeModal, getStatusBadge } from './utils.js';
import { roleIcons, defaultRole, getFilteredOccurrences } from './logic.js';
import { getIncidentByGroupId as fetchIncidentById, getStudentById, getOccurrencesForReport, getAbsencesForReport, saveDocumentSnapshot, findDocumentSnapshot, getLegalDocumentById, updateDocumentSignatures } from './firestore.js';


export const actionDisplayTitles = {
    tentativa_1: "1ª Tentativa de Contato",
    tentativa_2: "2ª Tentativa de Contato",
    tentativa_3: "3ª Tentativa de Contato",
    visita: "Visita In Loco",
    encaminhamento_ct: "Encaminhamento ao Conselho Tutelar",
    analise: "Análise"
};

// --- GESTÃO DE ESTADO LOCAL ---
let signatureMap = new Map();
let currentStream = null;
let savedPaths = [];
let currentPath = [];

// --- DADOS PARA ASSINATURA REMOTA ---
let currentDocumentIdForRemote = null; // ID do documento no Firestore
let currentDocumentKeyForRemote = null; // Ex: responsible_123

// --- DETECÇÃO DE IP (API EXTERNA) ---
const fetchClientMetadata = async () => {
    let ip = 'IP Indetectável';
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        ip = data.ip;
    } catch (e) { console.warn("Erro ao obter IP:", e); }

    return {
        ip: ip,
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString()
    };
};

// --- MODO "PARENT VIEW" (VISÃO DO PAI - LINK SEGURO) ---
const checkForRemoteSignParams = async () => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode');
    const docId = params.get('docId');
    const refId = params.get('refId');
    const type = params.get('type');
    const studentId = params.get('student');

    if (mode === 'sign') {
        console.log("Modo de Assinatura Remota Detectado");
        const urlParams = new URLSearchParams(window.location.search);
        const urlSchoolName = urlParams.get('schoolInfo') || 'Escola';
        const urlLogo = urlParams.get('schoolLogo') || '';

        document.body.innerHTML = `
            <div id="remote-sign-container" class="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4 font-sans">
                <div class="animate-pulse flex flex-col items-center">
                    ${urlLogo ? `<img src="${urlLogo}" class="w-20 h-20 object-contain mb-4">` : '<div class="h-12 w-12 bg-sky-200 rounded-full mb-4"></div>'}
                    <p class="text-sky-800 font-bold text-lg">${formatText(urlSchoolName)}</p>
                    <p class="text-gray-600 font-medium">Iniciando ambiente seguro...</p>
                </div>
            </div>`;

        try {
            let docSnapshot = null;

            // 1. TENTA BUSCAR SNAPSHOT EXISTENTE
            if (docId) {
                docSnapshot = await getLegalDocumentById(docId);
            } else if (refId && type) {
                docSnapshot = await findDocumentSnapshot(type, studentId, refId);
            }

            // 2. REGENERAÇÃO ON-THE-FLY (Se não achou snapshot salvo e temos REFID)
            if (!docSnapshot && refId && type && studentId) {
                console.log("Snapshot não encontrado. Tentando regenerar...");
                const student = await resolveStudentData(studentId);

                // Lógica de reconstrução
                let generatedHtml = "";
                let title = "";
                let docTitle = "";

                // --- REGENERADORES ---
                // Idealmente extraídos, mas aqui inline para garantir funcionamento sem refatoração massiva
                if (type === 'notificacao') { // Ficha
                    // FIX: Ensure types match (refId is string from URL, aid often number)
                    let record = state.absences.find(a => String(a.id) === String(refId));
                    if (!record) {
                        try {
                            const dataParam = new URLSearchParams(window.location.search).get('data');
                            if (dataParam) {
                                console.log("Using stateless data from URL...");
                                const extraData = JSON.parse(decodeURIComponent(dataParam));
                                record = {
                                    id: refId,
                                    studentId: studentId,
                                    absenceCount: extraData.absenceCount,
                                    periodoFaltasStart: extraData.periodoFaltasStart, // Note key mapping
                                    periodoFaltasEnd: extraData.periodoFaltasEnd,
                                    meetingDate: extraData.meetingDate,
                                    meetingTime: extraData.meetingTime,
                                    actionType: extraData.actionType || 'tentativa_1', // default fallback
                                    visitDate: extraData.visitDate,
                                    visitAgent: extraData.visitAgent,
                                    visitSucceeded: extraData.visitSucceeded,
                                    visitReason: extraData.visitReason,
                                    visitObs: extraData.visitObs
                                };
                            }
                        } catch (e) { console.error("Error parsing URL data:", e); }
                    }

                    if (!record) {
                        // Retry fetching from DB if URL data failed or missing
                        console.log("Record not in memory/URL, fetching from DB...");
                        try {
                            const records = await getAbsencesForReport();
                            record = records.find(a => String(a.id) === String(refId));
                        } catch (e) { console.error("DB Fetch failed:", e); }
                    }
                    if (record) {
                        // REPLICA LÓGICA DE 'openFichaViewModal'
                        const currentDateStr = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
                        title = "Notificação de Frequência Escolar";
                        docTitle = "Notificação - Ficha Busca Ativa";
                        const absences = record.absenceCount || 0;
                        const period = record.periodoFaltasStart ? `${formatDate(record.periodoFaltasStart)} a ${formatDate(record.periodoFaltasEnd)}` : 'Período não informado';

                        generatedHtml = `
                        <div class="space-y-6 text-sm font-serif leading-relaxed text-gray-900">
                            ${getReportHeaderHTML(new Date())}
                            <p class="text-right text-sm italic mb-4">${state.config?.city || "Cidade"}, ${currentDateStr}</p>
                            <h3 class="text-xl font-bold text-center uppercase border-b-2 border-gray-300 pb-2 mb-6">${title}</h3>
                            ${getStudentIdentityCardHTML(student)}
                            
                            <div class="bg-yellow-50 border border-yellow-200 p-4 rounded-lg my-6">
                                <h4 class="font-bold text-yellow-800 uppercase text-xs mb-2"><i class="fas fa-exclamation-triangle"></i> Motivo da Notificação</h4>
                                <p class="text-justify">
                                    Constatamos <strong>${absences} faltas</strong> consecutivas/alternadas no período de <strong>${period}</strong>, sem justificativa legal apresentada à secretaria escolar.
                                </p>
                            </div>

                            <div class="mb-6">
                                <h4 class="font-bold border-b border-gray-300 mb-2 uppercase text-xs text-gray-500">Fundamentação Legal</h4>
                                <p class="text-justify bg-gray-50 p-3 rounded border border-gray-200">
                                    Conforme Art. 12 da LDB nº 9.394/96 e Estatuto da Criança e do Adolescente (ECA), a escola tem o dever de notificar os responsáveis legais quando a infrequência escolar ultrapassa os limites permitidos, visando garantir o direito à educação.
                                </p>
                            </div>

                            <div class="mt-8 pt-4 border-t border-gray-300">
                                <p class="font-bold text-xs uppercase text-gray-500 mb-2">Ciência do Responsável:</p>
                                <p class="text-justify">
                                    Declaro estar ciente da situação de infrequência escolar do aluno(a) supracitado(a) e comprometo-me a justificar as ausências ou garantir o retorno imediato às atividades escolares, sob pena de encaminhamento aos órgãos de proteção (Conselho Tutelar).
                                </p>
                            </div>
                            
                            ${generateSignaturesGrid([{ key: `responsible_${student.matricula}`, role: 'Responsável Legal', name: '' }])}
                        </div>`;
                    }
                }

                if (generatedHtml) {
                    docSnapshot = {
                        id: 'temp_rebuilt', // ID Temporário
                        htmlContent: generatedHtml,
                        signatures: {},
                        studentId: studentId,
                        type: type,
                        title: docTitle || 'Documento'
                    };
                }
            }

            if (!docSnapshot) {
                const debugParams = new URLSearchParams(window.location.search);
                const hasData = debugParams.get('data');
                const debugHtml = `
                    <div class="bg-white p-8 rounded-lg shadow-xl mt-10 text-center">
                        <h1 class="text-2xl font-bold text-red-600 mb-2">Link Inválido (Debug Ativo)</h1>
                        <p class="mb-4">O sistema não conseguiu localizar ou reconstruir o documento.</p>
                        <div class="text-left bg-gray-100 p-4 rounded text-xs font-mono overflow-auto max-h-60">
                            <strong>Diagnóstico:</strong><br>
                            RefID: ${refId || 'N/A'}<br>
                            Type: ${type || 'N/A'}<br>
                            Student: ${studentId || 'N/A'}<br>
                            Data Param: ${hasData ? `Presente (${hasData.length} chars)` : 'AUSENTE'}<br>
                            URL Raw: ${window.location.search}
                        </div>
                    </div>`;

                document.getElementById('remote-sign-container').innerHTML = debugHtml;
                return;
            }

            // ... (rest of logic) ...


            const container = document.getElementById('remote-sign-container');
            const targetKey = `responsible_${String(studentId || docSnapshot.studentId)}`;


            if (docSnapshot.signatures && docSnapshot.signatures[targetKey]) {
                const sig = docSnapshot.signatures[targetKey];
                const signedDate = new Date(sig.timestamp).toLocaleString();

                container.classList.remove('justify-center'); container.classList.add('pt-4');
                container.innerHTML = `
                    <div class="w-full max-w-3xl bg-white shadow-2xl rounded-xl overflow-hidden mb-8 no-print font-sans">
                        <div class="bg-green-700 p-4 text-white flex justify-between items-center">
                            <div><h2 class="text-sm font-bold uppercase"><i class="fas fa-check-circle"></i> Documento Assinado</h2><p class="text-[10px] opacity-80">Registrado por: ${sig.signerName || 'Desconhecido'}</p></div>
                        </div>
                        
                        <!-- Conteúdo do Documento -->
                        <div class="p-6 md:p-10 text-sm bg-gray-50 border-b overflow-auto max-h-[60vh]">
                            ${docSnapshot.htmlContent}
                        </div>

                        <!-- Rodapé com Detalhes da Assinatura -->
                        <div class="bg-gray-100 p-6">
                            ${!docSnapshot.htmlContent.includes('signatures-wrapper-v2') ?
                        `<div class="bg-white p-4 rounded-lg shadow-sm border border-gray-200 mb-6">
                                <h3 class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 border-b pb-2">Dados da Assinatura Digital</h3>
                                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <p class="text-gray-500 text-xs">Assinado por</p>
                                        <p class="font-bold text-gray-800">${sig.signerName || 'Não informado'}</p>
                                    </div>
                                    <div>
                                        <p class="text-gray-500 text-xs">CPF</p>
                                        <p class="font-bold text-gray-800 font-mono">${sig.signerCPF || '***'}</p>
                                    </div>
                                    <div>
                                        <p class="text-gray-500 text-xs">Data/Hora</p>
                                        <p class="font-bold text-gray-800">${signedDate}</p>
                                    </div>
                                    <div>
                                        <p class="text-gray-500 text-xs">IP de Origem</p>
                                        <p class="font-bold text-gray-800 font-mono text-xs">${sig.ip || 'N/A'}</p>
                                    </div>
                                </div>
                                ${sig.photo ? `<div class="mt-4 pt-4 border-t flex flex-col items-center"><p class="text-xs text-gray-400 mb-2">Registro Biométrico Facial</p><img src="${sig.photo}" class="w-24 h-24 object-cover rounded-lg border shadow-sm"></div>` : ''}
                            </div>` :
                        `<div class="text-center mb-4 text-xs text-green-700 font-bold"><i class="fas fa-check-circle"></i> Assinatura Digital Incorporada ao Documento</div>`}

                            <button onclick="window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent('Olá, segue o link para acessar o documento assinado digitalmente: ' + window.location.href), '_blank')" class="w-full bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold py-3 px-4 rounded-lg shadow hover:shadow-lg transition flex items-center justify-center gap-3">
                                <i class="fab fa-whatsapp text-2xl"></i> 
                                <span>Enviar para mim (WhatsApp)</span>
                            </button>
                            
                            <p class="text-[10px] text-gray-400 text-center mt-4">Este documento possui validade jurídica assegurada pelo registro digital.</p>
                        </div>
                    </div>

                    <!-- Área Invisível para Impressão (Mantida igual para consistência) -->
                    <div id="print-area-signed" class="hidden print:block print:w-full print:h-auto bg-white p-8">
                            ${docSnapshot.htmlContent}
                            <div class="mt-8 pt-4 border-t border-gray-300">
                            <p class="font-bold text-sm">Assinado Digitalmente por:</p>
                            <p class="text-sm">${sig.signerName}</p>
                            <p class="text-sm">CPF: ${sig.signerCPF}</p>
                            <p class="text-xs text-gray-500 mt-1">Data: ${signedDate}</p>
                            ${sig.photo ? `<div class="mt-4"><p class="font-bold text-xs text-gray-400">Registro Biométrico:</p><img src="${sig.photo}" class="w-24 h-24 object-contain border rounded"></div>` : ''}
                            </div>
                    </div>
                `;
                return;
            }


            // FASE 1: DESAFIO DE IDENTIDADE
            const renderIdentityChallenge = () => {
                const docTypeLabel = type ? type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ') : 'Documento Oficial';

                container.innerHTML = `
                    <div class="w-full max-w-md bg-white shadow-2xl rounded-xl overflow-hidden font-sans">
                        <div class="bg-white p-6 text-center border-b border-gray-100 pb-8 pt-8">
                            ${urlLogo ? `<div class="mb-4 flex justify-center"><img src="${urlLogo}" class="h-24 object-contain"></div>` : '<div class="h-20 w-20 bg-sky-50 rounded-full mx-auto mb-4 flex items-center justify-center"><i class="fas fa-university text-sky-600 text-3xl"></i></div>'}
                            <h2 class="text-xl font-extrabold text-gray-900 uppercase leading-snug px-4">${formatText(urlSchoolName)}</h2>
                            <div class="mt-3">
                                <span class="inline-block bg-sky-50 text-sky-800 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider border border-sky-100">
                                    ${docTypeLabel}
                                </span>
                            </div>
                        </div>
                        <div class="p-8 space-y-5 bg-gray-50/50">
                            <div class="text-center mb-2">
                                <h3 class="text-lg font-bold text-gray-800">Área de Assinatura</h3>
                                <p class="text-sm text-gray-500">Confirme sua identidade para acessar.</p>
                            </div>
                            
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Seu Nome Completo</label>
                                <div class="relative">
                                    <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><i class="fas fa-user text-gray-400"></i></div>
                                    <input id="input-signer-name" type="text" class="w-full pl-10 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none uppercase text-sm font-semibold text-gray-700 transition" placeholder="DIGITE SEU NOME">
                                </div>
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Seu CPF</label>
                                <div class="relative">
                                    <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><i class="fas fa-id-card text-gray-400"></i></div>
                                    <input id="input-signer-cpf" type="tel" class="w-full pl-10 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none text-sm font-mono font-semibold text-gray-700 transition" placeholder="000.000.000-00" maxlength="14">
                                </div>
                            </div>
                            <button id="btn-access-doc" class="w-full mt-2 bg-sky-600 hover:bg-sky-700 text-white font-bold py-3.5 px-4 rounded-lg shadow-lg hover:shadow-xl transition transform active:scale-95 flex justify-center items-center gap-2">
                                <span>CONTINUAR</span> <i class="fas fa-arrow-right"></i>
                            </button>
                        </div>
                    </div>
                `;
                document.getElementById('input-signer-cpf').addEventListener('input', (e) => {
                    let v = e.target.value.replace(/\D/g, "");
                    if (v.length > 11) v = v.slice(0, 11);
                    v = v.replace(/(\d{3})(\d)/, "$1.$2");
                    v = v.replace(/(\d{3})(\d)/, "$1.$2");
                    v = v.replace(/(\d{3})(\d{1,2})$/, "$1-$2");
                    e.target.value = v;
                });
                document.getElementById('btn-access-doc').onclick = () => {
                    const name = document.getElementById('input-signer-name').value.trim();
                    const cpf = document.getElementById('input-signer-cpf').value.trim();
                    if (name.length < 5) { alert("Nome inválido."); return; }
                    if (cpf.length < 11) { alert("CPF inválido."); return; }
                    renderDocumentView({ name, cpf });
                };
            };

            // FASE 2: VISUALIZAÇÃO E ASSINATURA
            const renderDocumentView = (identityData) => {
                container.classList.remove('justify-center'); container.classList.add('pt-4');
                container.innerHTML = `
                    <div class="w-full max-w-3xl bg-white shadow-2xl rounded-xl overflow-hidden mb-8 no-print">
                        <div class="bg-green-700 p-4 text-white flex justify-between items-center">
                            <div><h2 class="text-sm font-bold uppercase"><i class="fas fa-file-contract"></i> Documento Liberado</h2><p class="text-[10px] opacity-80">Acesso por: ${identityData.name}</p></div>
                        </div>
                        <div class="p-6 md:p-10 text-sm bg-gray-50 border-b overflow-auto max-h-[60vh]">${docSnapshot.htmlContent}</div>
                        <div class="bg-gray-100 p-6 flex flex-col items-center gap-6">
                            <div class="w-full max-w-sm bg-white p-4 rounded-lg shadow-md border border-gray-300">
                                <div class="text-center mb-2"><p class="font-bold text-gray-800 text-sm uppercase"><i class="fas fa-camera"></i> Registro Biométrico Facial</p><p class="text-[10px] text-gray-500">Obrigatório para validar a assinatura.</p></div>
                                <div class="relative w-full h-64 bg-black rounded-lg overflow-hidden flex items-center justify-center mb-3">
                                    <video id="remote-video" autoplay playsinline class="w-full h-full object-cover transform scale-x-[-1]"></video>
                                    <canvas id="remote-canvas" class="hidden"></canvas>
                                    <img id="remote-photo-result" class="absolute inset-0 w-full h-full object-cover hidden transform scale-x-[-1]">
                                    <div id="camera-placeholder" class="absolute inset-0 flex flex-col items-center justify-center text-gray-400"><i class="fas fa-user-circle text-4xl mb-2"></i><p class="text-xs">Aguardando Câmera</p></div>
                                </div>
                                <div class="flex gap-2 justify-center">
                                    <button id="btn-start-remote-cam" class="bg-sky-600 text-white px-4 py-2 rounded text-xs font-bold hover:bg-sky-700 w-full"><i class="fas fa-video"></i> ATIVAR CÂMERA</button>
                                    <button id="btn-take-remote-pic" class="bg-green-600 text-white px-4 py-2 rounded text-xs font-bold hover:bg-green-700 w-full hidden"><i class="fas fa-camera"></i> TIRAR SELFIE</button>
                                    <button id="btn-retake-remote-pic" class="bg-yellow-500 text-white px-4 py-2 rounded text-xs font-bold hover:bg-yellow-600 w-full hidden"><i class="fas fa-redo"></i> REFAZER</button>
                                </div>
                            </div>
                            <div class="text-center w-full">
                                <p class="text-xs text-gray-600 max-w-md mx-auto text-justify mb-4">Eu, <strong>${identityData.name}</strong>, CPF <strong>${identityData.cpf}</strong>, declaro ter lido o documento acima e concordo com seu teor.</p>
                                <button id="btn-remote-agree" disabled class="w-full max-w-md bg-gray-400 text-white text-lg font-bold py-4 px-10 rounded-full shadow-lg flex items-center justify-center gap-2 cursor-not-allowed transition-all"><i class="fas fa-lock"></i> TIRE A SELFIE PARA ASSINAR</button>
                            </div>
                        </div>
                    </div>
                    <!-- Área Invisível para Impressão -->
                    <div id="print-area" class="hidden print:block print:w-full print:h-auto bg-white p-8">
                         ${docSnapshot.htmlContent}
                         <div class="mt-8 pt-4 border-t border-gray-300">
                            <p class="font-bold text-sm">Assinado Digitalmente por:</p>
                            <p class="text-sm">${identityData.name}</p>
                            <p class="text-sm">CPF: ${identityData.cpf}</p>
                            <p class="text-xs text-gray-500 mt-1">Data: ${new Date().toLocaleString()}</p>
                         </div>
                    </div>
                    `;

                let remoteStream = null;
                let capturedPhotoBase64 = null;
                const videoEl = document.getElementById('remote-video');
                const canvasEl = document.getElementById('remote-canvas');
                const imgEl = document.getElementById('remote-photo-result');
                const phEl = document.getElementById('camera-placeholder');
                const btnStart = document.getElementById('btn-start-remote-cam');
                const btnTake = document.getElementById('btn-take-remote-pic');
                const btnRetake = document.getElementById('btn-retake-remote-pic');
                const btnSign = document.getElementById('btn-remote-agree');

                btnStart.onclick = async () => {
                    try {
                        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
                        remoteStream = stream;
                        videoEl.srcObject = stream;
                        phEl.classList.add('hidden');
                        btnStart.classList.add('hidden');
                        btnTake.classList.remove('hidden');
                    } catch (err) { alert("Erro na câmera."); }
                };

                btnTake.onclick = () => {
                    if (!remoteStream) return;
                    canvasEl.width = videoEl.videoWidth;
                    canvasEl.height = videoEl.videoHeight;
                    const ctx = canvasEl.getContext('2d');
                    ctx.translate(canvasEl.width, 0); ctx.scale(-1, 1);
                    ctx.drawImage(videoEl, 0, 0);
                    capturedPhotoBase64 = canvasEl.toDataURL('image/jpeg', 0.5);
                    imgEl.src = capturedPhotoBase64; imgEl.classList.remove('hidden');
                    btnTake.classList.add('hidden'); btnRetake.classList.remove('hidden');
                    btnSign.disabled = false; btnSign.classList.remove('bg-gray-400', 'cursor-not-allowed'); btnSign.classList.add('bg-green-600', 'hover:bg-green-700', 'transform', 'hover:scale-105'); btnSign.innerHTML = '<i class="fas fa-check-double"></i> CONFIRMAR E ASSINAR';
                };

                btnRetake.onclick = () => {
                    capturedPhotoBase64 = null; imgEl.classList.add('hidden'); btnRetake.classList.add('hidden'); btnTake.classList.remove('hidden');
                    btnSign.disabled = true; btnSign.classList.add('bg-gray-400', 'cursor-not-allowed'); btnSign.classList.remove('bg-green-600', 'hover:bg-green-700', 'transform', 'hover:scale-105'); btnSign.innerHTML = '<i class="fas fa-lock"></i> TIRE A SELFIE PARA ASSINAR';
                };

                btnSign.onclick = async function () {
                    if (!capturedPhotoBase64) return;
                    this.disabled = true; this.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Salvando...';
                    const meta = await fetchClientMetadata();
                    const digitalSignature = { type: 'digital_ack', ip: meta.ip, device: meta.userAgent, timestamp: meta.timestamp, signerName: identityData.name, signerCPF: identityData.cpf, photo: capturedPhotoBase64, valid: true };

                    // --- UNIQUE KEY FOR MULTIPLE SIGNATURES (APPEND MODE) ---
                    // Generates a unique key based on timestamp to allow multiple signatures from same role/person
                    const key = `responsible_${String(studentId || docSnapshot.studentId)}_${Date.now()}`;
                    const sigMap = new Map(); sigMap.set(key, digitalSignature);

                    // --- HTML INJECTION ---
                    // Generate the signature card HTML
                    const signedDate = new Date(meta.timestamp).toLocaleString();
                    const signatureHtml = `
                    <div class="mt-8 pt-6 border-t-2 border-gray-100 break-inside-avoid signatures-wrapper-v2">
                        <div class="bg-green-50/50 p-4 rounded-lg border border-green-100">
                             <h3 class="text-xs font-bold text-green-700 uppercase tracking-wider mb-4 border-b border-green-200 pb-2 flex items-center gap-2">
                                <i class="fas fa-certificate"></i> Assinatura Digital Verificada
                             </h3>
                             <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                <div>
                                    <p class="text-gray-500 text-xs">Assinado por</p>
                                    <p class="font-bold text-gray-800">${identityData.name}</p>
                                </div>
                                <div>
                                    <p class="text-gray-500 text-xs">CPF</p>
                                    <p class="font-bold text-gray-800 font-mono">${identityData.cpf}</p>
                                </div>
                                <div>
                                    <p class="text-gray-500 text-xs">Data do Registro</p>
                                    <p class="font-bold text-gray-800">${signedDate}</p>
                                </div>
                                <div>
                                    <p class="text-gray-500 text-xs">IP / Dispositivo</p>
                                    <p class="font-bold text-gray-800 font-mono text-xs truncate" title="${meta.ip}">${meta.ip || 'N/A'}</p>
                                </div>
                            </div>
                            <div class="mt-4 pt-4 border-t border-green-100">
                                <p class="text-xs text-green-700 font-bold mb-2">Registro Biométrico Facial (Selfie)</p>
                                <img src="${capturedPhotoBase64}" class="w-24 h-24 object-cover rounded-lg border border-green-200 shadow-sm">
                            </div>
                        </div>
                    </div>`;

                    // --- APPEND LOGIC: ALWAYS APPEND ---
                    let newHtmlContent = docSnapshot.htmlContent + signatureHtml;

                    let success = false;
                    if (docSnapshot.id === 'temp_rebuilt') {
                        try {
                            const newDocRef = await saveDocumentSnapshot(docSnapshot.type, docSnapshot.title, newHtmlContent, docSnapshot.studentId, {
                                refId: refId || docSnapshot.id,
                                signatures: Object.fromEntries(sigMap),
                                studentName: studentId ? (await resolveStudentData(studentId)).name : 'Aluno'
                            });
                            if (newDocRef && newDocRef.id) success = true;
                        } catch (e) { console.error("Erro ao criar doc:", e); }
                    } else {
                        success = await updateDocumentSignatures(docSnapshot.id, sigMap, newHtmlContent);
                    }

                    if (success) {
                        if (remoteStream) remoteStream.getTracks().forEach(t => t.stop());

                        container.innerHTML = `
                        <div class="min-h-[80vh] flex flex-col items-center justify-center p-4 font-sans">
                            <div class="bg-white p-8 rounded-2xl shadow-xl text-center w-full max-w-md border-t-8 border-green-500">
                                <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
                                    <i class="fas fa-check text-2xl text-green-600"></i>
                                </div>
                                <h1 class="text-2xl font-bold text-gray-800 mb-2">Assinado com Sucesso!</h1>
                                <p class="text-gray-600 text-sm mb-6">O documento foi registrado no sistema.</p>
                                
                                <div class="space-y-3">
                                    <button onclick="window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent('Olá, segue o link para acessar o documento assinado digitalmente: ' + window.location.href), '_blank')" class="w-full bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold py-3 px-4 rounded-lg shadow hover:shadow-lg transition flex items-center justify-center gap-3">
                                        <i class="fab fa-whatsapp text-2xl"></i> 
                                        <span>Enviar Comprovante (WhatsApp)</span>
                                    </button>
                                    
                                    <button onclick="window.print()" class="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold py-3 px-4 rounded-lg shadow hover:shadow-lg transition flex items-center justify-center gap-3">
                                        <i class="fas fa-print text-xl"></i> 
                                        <span>Imprimir / Salvar PDF</span>
                                    </button>
                                </div>
                                <div class="mt-6 pt-4 border-t border-gray-100">
                                    <p class="text-[10px] text-gray-400">Escola: ${formatText(urlSchoolName)}</p>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Mantemos a área de impressão oculta mas presente -->
                        <div id="print-area-success" class="hidden print:block print:w-full print:h-auto bg-white p-8">
                             ${docSnapshot.htmlContent}
                             <div class="mt-8 pt-4 border-t border-gray-300">
                                <p class="font-bold text-sm">Assinado Digitalmente por:</p>
                                <p class="text-sm">${identityData.name}</p>
                                <p class="text-sm">CPF: ${identityData.cpf}</p>
                                <p class="text-xs text-gray-500 mt-1">Data: ${new Date().toLocaleString()}</p>
                                <div class="mt-4">
                                     <p class="font-bold text-xs text-gray-400">Registro Biométrico:</p>
                                     <img src="${capturedPhotoBase64}" class="w-32 h-32 object-contain border rounded">
                                </div>
                             </div>
                        </div>
                        `;
                    } else { alert("Erro ao salvar."); this.disabled = false; }
                };
            };
            renderIdentityChallenge();
        } catch (e) { alert("Erro fatal."); }
    }
};
setTimeout(checkForRemoteSignParams, 500);


// --- MODAL DE ASSINATURA ---

const ensureSignatureModalExists = () => {
    if (document.getElementById('signature-pad-modal')) return;

    const modalHTML = `
    <div id="signature-pad-modal" class="fixed inset-0 bg-gray-900 bg-opacity-75 hidden items-center justify-center z-[60] font-sans">
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 flex flex-col max-h-[95vh] overflow-hidden">
            
            <div class="flex border-b bg-gray-50">
                <button id="tab-draw" class="flex-1 py-3 text-sm font-bold text-sky-700 border-b-2 border-sky-600 bg-white transition"><i class="fas fa-pen-alt mr-1"></i> Desenhar</button>
                <button id="tab-link" class="flex-1 py-3 text-sm font-bold text-gray-500 hover:text-sky-600 transition"><i class="fas fa-fingerprint mr-1"></i> Digital / Link</button>
            </div>
            
            <div class="p-4 overflow-y-auto">
                
                <!-- TAB 1: DESENHO -->
                <div id="content-tab-draw">
                    <div class="bg-black rounded-lg overflow-hidden relative mb-4 h-40 flex items-center justify-center group shadow-inner">
                        <video id="camera-preview" autoplay playsinline class="w-full h-full object-cover"></video>
                        <canvas id="photo-canvas" class="hidden"></canvas>
                        <img id="photo-result" class="hidden w-full h-full object-cover absolute top-0 left-0 z-10" />
                        <div class="absolute bottom-2 w-full flex justify-center gap-2 z-20">
                            <button id="btn-take-photo" class="bg-white text-gray-900 rounded-full px-3 py-1 text-xs font-bold shadow hover:bg-gray-200"><i class="fas fa-camera"></i> Foto</button>
                            <button id="btn-retake-photo" class="hidden bg-yellow-400 text-yellow-900 rounded-full px-3 py-1 text-xs font-bold shadow"><i class="fas fa-redo"></i> Refazer</button>
                        </div>
                    </div>
                    <div class="flex justify-between items-end mb-1">
                        <p class="text-xs font-bold text-gray-600 uppercase">Assinatura</p>
                        <div class="flex gap-1">
                            <button id="btn-undo-signature" class="bg-gray-200 px-2 py-0.5 rounded text-[10px] font-bold hover:bg-gray-300"><i class="fas fa-undo"></i></button>
                            <button id="btn-clear-signature" class="bg-red-100 text-red-700 px-2 py-0.5 rounded text-[10px] font-bold hover:bg-red-200"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                    <div class="border-2 border-dashed border-gray-400 rounded bg-gray-50 relative touch-none" style="touch-action: none;">
                        <canvas id="signature-canvas" class="w-full h-32 cursor-crosshair"></canvas>
                    </div>
                </div>

                <!-- TAB 2: LINK OU PRESENCIAL -->
                <div id="content-tab-link" class="hidden">
                    <div id="local-options-container" class="space-y-4">
                        <div class="bg-green-50 border border-green-200 rounded-lg p-4">
                            <h4 class="font-bold text-green-800 text-sm mb-1"><i class="fab fa-whatsapp"></i> Enviar Link para Casa</h4>
                            <p class="text-xs text-green-700 mb-3">Gere um link para o responsável assinar do próprio celular.</p>
                            <div class="bg-white p-2 rounded border border-gray-200 text-[10px] text-gray-500 mb-3 font-mono break-all" id="generated-link-preview">...</div>
                            <button id="btn-send-whatsapp" class="w-full bg-green-600 text-white font-bold py-2 rounded shadow text-sm"><i class="fas fa-share"></i> Enviar Link</button>
                        </div>
                        <div class="flex items-center justify-center text-gray-400 text-xs font-bold">- OU -</div>
                        <div class="bg-sky-50 border border-sky-200 rounded-lg p-4 text-center">
                            <h4 class="font-bold text-sky-800 text-sm mb-1">Assinar Agora (Biometria)</h4>
                            <p class="text-xs text-sky-700 mb-3">Coleta Nome, CPF e Selfie neste dispositivo.</p>
                            <button id="btn-start-local-flow" class="w-full bg-sky-600 text-white font-bold py-3 rounded shadow"><i class="fas fa-user-check"></i> INICIAR COLETA</button>
                        </div>
                    </div>

                    <!-- FLUXO LOCAL DE IDENTIDADE -->
                    <div id="local-identity-container" class="hidden space-y-3">
                         <h4 class="font-bold text-gray-700 text-center border-b pb-2">Identificação do Responsável</h4>
                         <div><label class="text-xs font-bold text-gray-500">Nome Completo</label><input id="local-signer-name" type="text" class="w-full border p-2 rounded uppercase text-sm"></div>
                         <div><label class="text-xs font-bold text-gray-500">CPF</label><input id="local-signer-cpf" type="tel" class="w-full border p-2 rounded text-sm" maxlength="14"></div>
                         <div class="flex gap-2 mt-4">
                            <button id="btn-cancel-local" class="flex-1 bg-gray-200 text-gray-700 py-2 rounded text-xs font-bold">Voltar</button>
                            <button id="btn-next-local" class="flex-1 bg-sky-600 text-white py-2 rounded text-xs font-bold">Próximo</button>
                         </div>
                    </div>

                    <!-- FLUXO LOCAL DE SELFIE -->
                    <div id="local-selfie-container" class="hidden flex flex-col items-center">
                        <h4 class="font-bold text-gray-700 text-center mb-2">Validação Biométrica</h4>
                        <div class="relative w-full h-48 bg-black rounded-lg overflow-hidden flex items-center justify-center mb-3">
                            <video id="local-video" autoplay playsinline class="w-full h-full object-cover transform scale-x-[-1]"></video>
                            <canvas id="local-canvas" class="hidden"></canvas>
                            <img id="local-photo-result" class="absolute inset-0 w-full h-full object-cover hidden transform scale-x-[-1]">
                        </div>
                        <div class="flex gap-2 w-full mb-3">
                            <button id="btn-local-take" class="flex-1 bg-green-600 text-white py-2 rounded text-xs font-bold"><i class="fas fa-camera"></i> Capturar</button>
                            <button id="btn-local-retake" class="hidden flex-1 bg-yellow-500 text-white py-2 rounded text-xs font-bold"><i class="fas fa-redo"></i> Refazer</button>
                        </div>
                        <button id="btn-finish-local" disabled class="w-full bg-gray-400 text-white py-3 rounded font-bold shadow cursor-not-allowed">CONFIRMAR ASSINATURA</button>
                        <button id="btn-back-to-identity" class="mt-2 text-xs text-gray-500 underline">Voltar</button>
                    </div>
                </div>

            </div>

            <div class="flex justify-between items-center bg-gray-50 p-3 border-t">
                <button id="btn-cancel-signature" class="px-4 py-2 rounded text-gray-600 hover:bg-gray-200 text-xs font-bold">Cancelar</button>
                <button id="btn-confirm-signature" class="px-6 py-2 rounded bg-gray-900 text-white font-bold hover:bg-gray-800 shadow text-xs">Salvar Desenho</button>
            </div>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    setupSignaturePadEvents();
};

const setupSignaturePadEvents = () => {
    const modal = document.getElementById('signature-pad-modal');
    const canvas = document.getElementById('signature-canvas');
    const ctx = canvas.getContext('2d');

    const tabDraw = document.getElementById('tab-draw');
    const tabLink = document.getElementById('tab-link');
    const contentDraw = document.getElementById('content-tab-draw');
    const contentLink = document.getElementById('content-tab-link');
    const btnConfirm = document.getElementById('btn-confirm-signature');

    // ELEMENTOS DO FLUXO LOCAL
    const localOptions = document.getElementById('local-options-container');
    const localIdentity = document.getElementById('local-identity-container');
    const localSelfie = document.getElementById('local-selfie-container');

    // --- LÓGICA DE ABAS ---
    const switchTab = (tab) => {
        if (tab === 'draw') {
            contentDraw.classList.remove('hidden'); contentLink.classList.add('hidden');
            tabDraw.className = "flex-1 py-3 text-sm font-bold text-sky-700 border-b-2 border-sky-600 bg-white transition";
            tabLink.className = "flex-1 py-3 text-sm font-bold text-gray-500 hover:text-sky-600 transition";
            btnConfirm.classList.remove('hidden');
            startCamera(); // Camera do Tab 1 (Desenho)
            const rect = canvas.parentElement.getBoundingClientRect();
            if (rect.width > 0) { canvas.width = rect.width; canvas.height = 128; redrawCanvas(); }
        } else {
            contentDraw.classList.add('hidden'); contentLink.classList.remove('hidden');
            tabLink.className = "flex-1 py-3 text-sm font-bold text-sky-700 border-b-2 border-sky-600 bg-white transition";
            tabDraw.className = "flex-1 py-3 text-sm font-bold text-gray-500 hover:text-sky-600 transition";
            btnConfirm.classList.add('hidden');
            stopCameraStream(); // Para camera do Tab 1

            // Reseta fluxo local
            localOptions.classList.remove('hidden');
            localIdentity.classList.add('hidden');
            localSelfie.classList.add('hidden');

            // Gera Link
            const baseUrl = window.location.href.split('?')[0];
            const sName = encodeURIComponent(state.config?.schoolName || 'Escola');
            const sLogo = encodeURIComponent(state.config?.schoolLogoUrl || '');

            // FIX: Se não temos ID (doc novo), usamos os parâmetros de referência
            let linkParams = `mode=sign&type=notificacao&schoolInfo=${sName}&schoolLogo=${sLogo}`;

            if (currentDocumentIdForRemote && currentDocumentIdForRemote !== 'temp' && !currentDocumentIdForRemote.startsWith('temp')) {
                linkParams += `&docId=${currentDocumentIdForRemote}`;
            } else {
                // Tenta extrair dados do 'currentDocumentKeyForRemote' ou do contexto global se possível?
                // O ideal é que 'openSignaturePad' receba esses dados.
                // Mas como fallback, vamos tentar reconstruir.
                // O 'student' está no key: responsible_123
                const studentIdParts = currentDocumentKeyForRemote.split('_');
                const studentId = studentIdParts.length > 1 ? studentIdParts[1] : '';

                // Precisamos do REFID e TYPE.
                // O 'renderDocumentModal' sabe disso. 
                // Vamos tentar pegar do atributo data do container se existir.
                const contentDiv = document.querySelector(`[data-doc-ref-id="${currentDocumentIdForRemote}"]`) || document.querySelector('.report-view-content') || document.getElementById('notification-content');
                // Isso é frágil.
                // Melhor: O 'openSignaturePad' deve receber esses metadados.
                // Por enquanto, vamos assumir que o studentId é suficiente se o type for fixo 'notificacao' (que é o caso principal)
                // Porem, precisamos do refId.

                // CORREÇÃO PALIATIVA: 
                // Vamos pegar o refId que está no container pai do botão de assinatura clicado?
                // Não temos acesso ao elemento clicado aqui facilmente.

                // MUDANÇA: O link só será gerado corretamente se passarmos os dados extras para openSignaturePad.
                // Mas para corrigir RÁPIDO:
                linkParams += `&student=${studentId}`;
            }

            if (window.currentDocParams) { // Injetado no click
                if (window.currentDocParams.refId) linkParams += `&refId=${window.currentDocParams.refId}`;
                if (window.currentDocParams.type) linkParams = linkParams.replace('type=notificacao', `type=${window.currentDocParams.type}`);

                if (window.currentDocParams.studentId) {
                    if (linkParams.includes('student=')) {
                        linkParams = linkParams.replace(/student=[^&]*/, `student=${window.currentDocParams.studentId}`);
                    } else {
                        linkParams += `&student=${window.currentDocParams.studentId}`;
                    }
                }

                if (window.currentDocParams.extraData) {
                    const payload = encodeURIComponent(JSON.stringify(window.currentDocParams.extraData));
                    linkParams += `&data=${payload}`;
                }
            }

            const fullLink = `${baseUrl}?${linkParams}`;
            document.getElementById('generated-link-preview').innerText = fullLink;
            document.getElementById('btn-send-whatsapp').onclick = () => window.open(`https://wa.me/?text=${encodeURIComponent(`Link para assinatura: ${fullLink}`)}`, '_blank');
        }
    };

    tabDraw.onclick = () => switchTab('draw');
    tabLink.onclick = () => switchTab('link');

    // --- LÓGICA DO FLUXO LOCAL PRESENCIAL (Novo) ---
    let localStream = null;
    let localCapturedPhoto = null;

    document.getElementById('btn-start-local-flow').onclick = () => {
        localOptions.classList.add('hidden');
        localIdentity.classList.remove('hidden');
    };

    document.getElementById('btn-cancel-local').onclick = () => {
        localIdentity.classList.add('hidden');
        localOptions.classList.remove('hidden');
    };

    document.getElementById('local-signer-cpf').addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, "");
        if (v.length > 11) v = v.slice(0, 11);
        v = v.replace(/(\d{3})(\d)/, "$1.$2"); v = v.replace(/(\d{3})(\d)/, "$1.$2"); v = v.replace(/(\d{3})(\d{1,2})$/, "$1-$2");
        e.target.value = v;
    });

    document.getElementById('btn-next-local').onclick = async () => {
        const name = document.getElementById('local-signer-name').value.trim();
        const cpf = document.getElementById('local-signer-cpf').value.trim();
        if (name.length < 5 || cpf.length < 11) return alert("Preencha Nome e CPF corretamente.");

        localIdentity.classList.add('hidden');
        localSelfie.classList.remove('hidden');

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
            localStream = stream;
            document.getElementById('local-video').srcObject = stream;
        } catch (e) { alert("Erro ao abrir câmera."); }
    };

    document.getElementById('btn-back-to-identity').onclick = () => {
        if (localStream) localStream.getTracks().forEach(t => t.stop());
        localSelfie.classList.add('hidden');
        localIdentity.classList.remove('hidden');
    };

    document.getElementById('btn-local-take').onclick = () => {
        const vid = document.getElementById('local-video');
        const can = document.getElementById('local-canvas');
        const img = document.getElementById('local-photo-result');

        can.width = vid.videoWidth; can.height = vid.videoHeight;
        const ctxL = can.getContext('2d');
        ctxL.translate(can.width, 0); ctxL.scale(-1, 1);
        ctxL.drawImage(vid, 0, 0);

        localCapturedPhoto = can.toDataURL('image/jpeg', 0.5);
        img.src = localCapturedPhoto; img.classList.remove('hidden');

        document.getElementById('btn-local-take').classList.add('hidden');
        document.getElementById('btn-local-retake').classList.remove('hidden');

        const btnFinish = document.getElementById('btn-finish-local');
        btnFinish.disabled = false; btnFinish.classList.remove('bg-gray-400', 'cursor-not-allowed'); btnFinish.classList.add('bg-sky-600', 'hover:bg-sky-700');
    };

    document.getElementById('btn-local-retake').onclick = () => {
        localCapturedPhoto = null;
        document.getElementById('local-photo-result').classList.add('hidden');
        document.getElementById('btn-local-take').classList.remove('hidden');
        document.getElementById('btn-local-retake').classList.add('hidden');
        const btnFinish = document.getElementById('btn-finish-local');
        btnFinish.disabled = true; btnFinish.classList.add('bg-gray-400', 'cursor-not-allowed'); btnFinish.classList.remove('bg-sky-600', 'hover:bg-sky-700');
    };

    document.getElementById('btn-finish-local').onclick = async () => {
        if (!localCapturedPhoto) return;
        const name = document.getElementById('local-signer-name').value.trim();
        const cpf = document.getElementById('local-signer-cpf').value.trim();

        showToast("Registrando...");
        const meta = await fetchClientMetadata();

        const digitalData = {
            type: 'digital_ack',
            ip: meta.ip,
            device: meta.userAgent,
            timestamp: meta.timestamp,
            signerName: name,
            signerCPF: cpf,
            photo: localCapturedPhoto,
            valid: true
        };

        if (localStream) localStream.getTracks().forEach(t => t.stop());
        if (currentStream) currentStream.getTracks().forEach(t => t.stop()); // Garante que tudo para

        modal.classList.add('hidden'); modal.classList.remove('flex');
        if (modal._onConfirmCallback) modal._onConfirmCallback(digitalData);
    };

    // --- LÓGICA DA CÂMERA (TAB 1) ---
    const btnTake = document.getElementById('btn-take-photo');
    const btnRetake = document.getElementById('btn-retake-photo');
    const video = document.getElementById('camera-preview');
    const photoResult = document.getElementById('photo-result');
    const photoCanvas = document.getElementById('photo-canvas');
    let capturedPhotoData = null;

    btnTake.onclick = () => {
        if (!currentStream) return showToast("Câmera desligada.");
        photoCanvas.width = video.videoWidth; photoCanvas.height = video.videoHeight;
        photoCanvas.getContext('2d').drawImage(video, 0, 0);
        capturedPhotoData = photoCanvas.toDataURL('image/jpeg', 0.6);
        photoResult.src = capturedPhotoData; photoResult.classList.remove('hidden');
        btnTake.classList.add('hidden'); btnRetake.classList.remove('hidden');
    };

    btnRetake.onclick = () => {
        capturedPhotoData = null; photoResult.classList.add('hidden');
        btnTake.classList.remove('hidden'); btnRetake.classList.add('hidden');
    };

    // --- CORREÇÃO DO CANVAS (GHOSTING FIX) ---
    const redrawCanvas = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#000';
        savedPaths.forEach(path => {
            ctx.beginPath();
            if (path.length) {
                ctx.moveTo(path[0].x, path[0].y);
                path.forEach(p => ctx.lineTo(p.x, p.y));
                ctx.stroke();
            }
        });
    };

    let isDrawing = false;
    const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: (clientX - rect.left) * (canvas.width / rect.width), y: (clientY - rect.top) * (canvas.height / rect.height) };
    };

    // FIX: Separar lógica de path atual do histórico
    canvas.addEventListener('mousedown', (e) => {
        isDrawing = true;
        currentPath = [getPos(e)];
        ctx.beginPath(); // IMPORTANTE
        ctx.moveTo(currentPath[0].x, currentPath[0].y);
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!isDrawing) return;
        const p = getPos(e);
        currentPath.push(p);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        // Não chamamos beginPath aqui para que o traço seja contínuo
    });

    canvas.addEventListener('mouseup', () => {
        if (isDrawing) {
            isDrawing = false;
            savedPaths.push([...currentPath]);
            // Não precisa chamar redrawCanvas aqui pois o traço já está na tela
        }
    });

    // Touch Support (com preventDefault para não rolar a tela)
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        isDrawing = true;
        currentPath = [getPos(e)];
        ctx.beginPath();
        ctx.moveTo(currentPath[0].x, currentPath[0].y);
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (!isDrawing) return;
        const p = getPos(e);
        currentPath.push(p);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        if (isDrawing) {
            isDrawing = false;
            savedPaths.push([...currentPath]);
        }
    });

    document.getElementById('btn-undo-signature').onclick = () => { savedPaths.pop(); redrawCanvas(); };
    document.getElementById('btn-clear-signature').onclick = () => { savedPaths = []; currentPath = []; ctx.clearRect(0, 0, canvas.width, canvas.height); };

    btnConfirm.onclick = () => {
        const signatureData = canvas.toDataURL('image/png');
        const evidenceData = !photoResult.classList.contains('hidden') ? photoResult.src : null;
        stopCameraStream();
        modal.classList.add('hidden'); modal.classList.remove('flex');
        if (modal._onConfirmCallback) modal._onConfirmCallback({ signature: signatureData, photo: evidenceData });
    };

    document.getElementById('btn-cancel-signature').onclick = () => {
        stopCameraStream();
        if (localStream) localStream.getTracks().forEach(t => t.stop());
        modal.classList.add('hidden'); modal.classList.remove('flex');
    };
};

const startCamera = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        currentStream = stream;
        document.getElementById('camera-preview').srcObject = stream;
    } catch (e) { console.error("Erro Câmera Tab 1", e); }
};

const stopCameraStream = () => {
    if (currentStream) currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
};

// --- ABRIR MODAL ---
// --- ABRIR MODAL ---
const openSignaturePad = (key, docRefId, onConfirm) => {
    ensureSignatureModalExists();
    const modal = document.getElementById('signature-pad-modal');
    modal._onConfirmCallback = onConfirm;

    currentDocumentKeyForRemote = key;
    currentDocumentIdForRemote = docRefId;
    savedPaths = [];
    currentPath = [];

    // Force refresh link preview if it exists
    const linkPreview = document.getElementById('generated-link-preview');
    if (linkPreview) linkPreview.innerText = "Carregando...";

    // Reset tabs
    document.getElementById('tab-draw').click(); // Reseta para aba de desenho

    const canvas = document.getElementById('signature-canvas');
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);

    modal.classList.remove('hidden'); modal.classList.add('flex');
};


// --- HELPERS DE DADOS E HTML ---

const resolveStudentData = async (studentId, recordSource = null) => {
    let memoryStudent = state.students.find(s => s.matricula === studentId);
    if (!memoryStudent) memoryStudent = await getStudentById(studentId);
    return {
        matricula: studentId,
        name: recordSource?.studentName || memoryStudent?.name || `Aluno (${studentId})`,
        class: recordSource?.studentClass || memoryStudent?.class || 'N/A',
        resp1: memoryStudent?.resp1 || ''
    };
};

export const getReportHeaderHTML = (dateObj = new Date()) => {
    const logoUrl = state.config?.schoolLogoUrl || null;
    const schoolName = state.config?.schoolName || "Nome da Escola";
    const city = state.config?.city || "Cidade";
    const year = dateObj.getFullYear();
    if (logoUrl) {
        return `<div class="flex items-center gap-4 border-b-2 border-gray-800 pb-4 mb-2"><img src="${logoUrl}" alt="Logo" class="w-20 h-20 object-contain" onerror="this.style.display='none'"><div class="flex-1 text-center sm:text-left"><h2 class="text-xl font-bold uppercase tracking-wide text-gray-900">${schoolName}</h2><p class="text-sm text-gray-600 font-semibold uppercase mt-1">${city}</p><p class="text-xs text-gray-500 mt-1">Sistema de Acompanhamento Pedagógico</p></div><div class="hidden sm:block text-right text-xs text-gray-400"><p>Documento Oficial</p><p>${year}</p></div></div>`;
    }
    return `<div class="text-center border-b-2 border-gray-800 pb-4 mb-2"><h2 class="text-2xl font-bold uppercase tracking-wide text-gray-900">${schoolName}</h2><p class="text-sm text-gray-600 font-semibold uppercase mt-1">${city}</p></div>`;
};

const getStudentIdentityCardHTML = (student) => {
    const responsaveis = [student.resp1, student.resp2].filter(Boolean).join(' e ') || 'Não informados';
    return `<div class="student-id-card break-inside-avoid mb-4"><div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm border p-2 rounded bg-gray-50"><div class="col-span-2 border-b mb-1 pb-1 font-bold text-gray-500 text-xs uppercase">Dados do Aluno</div><div><strong>Nome:</strong> <span class="uppercase">${formatText(student.name)}</span></div><div><strong>Turma:</strong> ${formatText(student.class)}</div><div class="sm:col-span-2"><strong>Responsáveis:</strong> ${formatText(responsaveis)}</div></div></div>`;
};

const getPrintHTML = (prints, singlePrintFallback) => {
    let images = [];
    if (Array.isArray(prints) && prints.length > 0) images = prints;
    else if (singlePrintFallback) images = [singlePrintFallback];
    if (images.length === 0) return '';
    const isVideo = (src) => src.includes('.mp4') || src.includes('.webm');
    const isAudio = (src) => src.includes('.mp3') || src.includes('.wav');
    const gridClass = images.length > 1 ? 'grid grid-cols-2 gap-2' : 'flex justify-center';
    const imgsHtml = images.map((src, idx) => {
        if (isVideo(src)) return `<div class="text-center border rounded p-2"><p class="text-xs mb-1">Vídeo ${idx + 1}</p><video src="${src}" controls class="max-w-full h-auto max-h-[250px]"></video></div>`;
        if (isAudio(src)) return `<div class="text-center border rounded p-2"><p class="text-xs mb-1">Áudio ${idx + 1}</p><audio src="${src}" controls class="w-full"></audio></div>`;
        return `<div class="text-center"><img src="${src}" class="max-w-full h-auto max-h-[250px] border rounded shadow-sm object-contain bg-white mx-auto" alt="Anexo ${idx + 1}"><p class="text-[10px] text-gray-500 mt-1">Anexo ${idx + 1}</p></div>`;
    }).join('');
    return `<div class="mt-3 mb-3 p-3 border border-gray-200 rounded bg-white break-inside-avoid"><p class="text-xs font-bold text-gray-500 mb-2 border-b pb-1"><i class="fas fa-paperclip"></i> Evidências / Anexos:</p><div class="${gridClass}">${imgsHtml}</div></div>`;
};

const getAttemptsTableHTML = (records, type = 'occurrence') => {
    let attempts = [];
    if (type === 'occurrence') {
        const rec = records;
        for (let i = 1; i <= 3; i++) {
            const mDate = (i === 1) ? (rec.meetingDate || rec.meetingDate_1) : rec[`meetingDate_${i}`];
            if (mDate) {
                const succ = rec[`contactSucceeded_${i}`];
                let status = "Pendente";
                if (succ === 'yes') status = "Contato Realizado";
                else if (succ === 'no') status = "Sem Sucesso / Não Compareceu";
                attempts.push({ etapa: `${i}ª Convocação`, data: formatDate(mDate), status: status });
            }
        }
    } else {
        const contactActions = records.filter(a => a.actionType.startsWith('tentativa'));
        const visitAction = records.find(a => a.actionType === 'visita');
        contactActions.forEach((a, idx) => {
            const mDate = a.contactDate || a.meetingDate;
            let status = "Pendente";
            if (a.contactSucceeded === 'yes') status = "Contato Realizado";
            else if (a.contactSucceeded === 'no') status = "Sem Sucesso";
            else if (a.meetingDate && !a.contactSucceeded) status = "Agendado";
            attempts.push({ etapa: `${idx + 1}ª Tentativa`, data: formatDate(mDate), status: status });
        });
        if (visitAction) {
            let vStatus = "Realizada";
            if (visitAction.visitSucceeded === 'no') vStatus = "Sem Contato na Visita";
            attempts.push({ etapa: "Visita Domiciliar", data: formatDate(visitAction.visitDate), status: vStatus });
        }
    }
    if (attempts.length === 0) return '<p class="text-sm italic text-gray-500 my-2">Nenhuma tentativa formal registrada.</p>';
    const rows = attempts.map(a => `<tr><td>${a.etapa}</td><td>${a.data}</td><td>${a.status}</td></tr>`).join('');
    return `<table class="report-table"><thead><tr><th style="width: 30%">Ação</th><th style="width: 25%">Data</th><th>Resultado</th></tr></thead><tbody>${rows}</tbody></table>`;
};

// --- VISUAL DA ASSINATURA (LAYOUT COMPACTO & DADOS COMPLETOS) ---
const getSingleSignatureBoxHTML = (key, roleTitle, nameSubtitle, sigData) => {
    // 1. Digital com Biometria
    if (sigData && sigData.type === 'digital_ack') {
        return `
            <div class="relative group border border-green-500 bg-green-50 rounded flex flex-row overflow-hidden h-32" data-sig-key="${key}">
                <div class="flex-1 p-2 flex flex-col justify-between overflow-hidden">
                    <div class="overflow-y-auto">
                        <p class="font-bold uppercase text-xs text-green-800 leading-tight">${roleTitle}</p>
                        <p class="text-[10px] text-green-700 font-semibold mb-1 truncate">${nameSubtitle}</p>
                        <div class="text-[10px] text-gray-700 leading-snug break-words whitespace-normal">
                            ${sigData.signerName ? `<span class="font-bold">Nome:</span> ${sigData.signerName}<br>` : ''}
                            ${sigData.signerCPF ? `<span class="font-bold">CPF:</span> ${sigData.signerCPF}<br>` : ''}
                            <span class="font-bold">IP:</span> ${sigData.ip || 'N/A'}<br>
                            ${new Date(sigData.timestamp).toLocaleString()}
                        </div>
                    </div>
                    <div class="bg-green-500 text-white text-[9px] px-2 py-0.5 rounded w-fit mt-1"><i class="fas fa-check"></i> Válido</div>
                </div>
                ${sigData.photo ? `<div class="w-32 min-w-[30%] border-l border-green-200"><img src="${sigData.photo}" class="w-full h-full object-cover"></div>` : ''}
            </div>`;
    }
    // 2. Desenhada
    else if (sigData && (sigData.signature || typeof sigData === 'string')) {
        const img = sigData.signature || sigData;
        const photo = sigData.photo;
        return `
            <div class="relative group cursor-pointer border border-gray-300 rounded bg-white flex flex-row h-32 overflow-hidden" data-sig-key="${key}">
                 ${photo ? `<div class="w-32 min-w-[30%] border-r border-gray-200"><img src="${photo}" class="w-full h-full object-cover" /></div>` : `<div class="w-8 bg-gray-50 border-r border-gray-200 flex items-center justify-center"><i class="fas fa-pen-nib text-gray-300"></i></div>`}
                <div class="flex-1 flex flex-col p-2 justify-between relative overflow-hidden">
                    <img src="${img}" class="h-16 object-contain mix-blend-multiply self-center" />
                    <div class="border-t border-black w-full pt-1 text-center">
                        <p class="text-[9px] font-bold uppercase leading-none">${roleTitle}</p>
                        <p class="text-[8px] text-gray-500 truncate">${nameSubtitle}</p>
                    </div>
                </div>
            </div>`;
    }
    // 3. Vazio
    else {
        return `
            <div class="h-32 border border-dashed border-gray-300 rounded bg-gray-50 flex flex-col items-center justify-center text-gray-400 cursor-pointer hover:bg-gray-100 transition signature-interaction-area" data-sig-key="${key}">
                <i class="fas fa-fingerprint text-xl mb-1 opacity-50"></i>
                <p class="text-[9px] uppercase font-bold text-center">Aguardando<br>Assinatura</p>
                <p class="text-[8px] mt-1">${roleTitle}</p>
            </div>`;
    }
};

const generateSignaturesGrid = (slots) => {
    let itemsHTML = slots.map(slot => {
        const sigData = signatureMap.get(slot.key);
        return getSingleSignatureBoxHTML(slot.key, slot.role, slot.name, sigData);
    }).join('');

    const mgmtData = signatureMap.get('management');
    return `
        <div class="mt-6 mb-4 break-inside-avoid p-3 bg-gray-50 rounded border border-gray-200">
             <h5 class="text-[9px] font-bold uppercase text-gray-500 mb-3 border-b border-gray-300 pb-1 flex justify-between">
                <span>Registro de Validação</span>
                <span class="font-normal"><i class="fas fa-shield-alt"></i> Biometria</span>
             </h5>
             <!-- LAYOUT: 3 COLUNAS (Ajustado p/ 4 em telas grandes) -->
             <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">${itemsHTML}</div>
             
             <div class="mt-4 pt-2 border-t border-gray-200 flex justify-center">
                <div class="w-full max-w-[250px]">
                    <p class="text-[8px] text-gray-400 text-center mb-1 uppercase">Gestão Escolar</p>
                    ${getSingleSignatureBoxHTML('management', 'Gestão', state.config?.schoolName || 'Direção', mgmtData)}
                </div>
             </div>
        </div>`;
};

const getPrintFooterHTML = (docId, dateObj) => {
    const dateStr = dateObj.toLocaleDateString('pt-BR');
    const id = docId || 'Novo Documento';
    return `<div class="print-footer">
        Documento ID: ${id} • Emitido em: ${dateStr} • Sistema Pedagógico
     </div>`;
};

// --- FUNÇÃO CENTRAL DE RENDERIZAÇÃO (IMPORTANTE) ---
async function generateSmartHTML(docType, studentId, refId, htmlGeneratorFn) {
    // 1. Tenta carregar dados existentes do banco
    const existingDoc = await findDocumentSnapshot(docType, studentId, refId);

    // 2. Se houver dados no banco, atualiza o mapa local APENAS se não tivermos uma versão mais nova localmente
    // A chave aqui é que signatureMap "vence" se já tiver algo gravado na sessão atual
    if (existingDoc && existingDoc.signatures) {
        Object.entries(existingDoc.signatures).forEach(([k, v]) => {
            if (!signatureMap.has(k)) {
                signatureMap.set(k, v);
            }
        });
    }

    // 3. Gera o HTML usando o mapa atualizado (seja do banco ou da memória local)
    const newDate = existingDoc?.createdAt?.toDate() || new Date();
    let html = htmlGeneratorFn(newDate);

    // INJECT PRINT FOOTER AUTOMATICALLY
    html += getPrintFooterHTML(existingDoc?.id, newDate);

    return { html, docId: existingDoc?.id };
}

const renderDocumentModal = async (title, contentDivId, docType, studentId, refId, generatorFn, extraData = null) => {
    // Gera o HTML já com a assinatura que está em memória (signatureMap)
    const { html, docId } = await generateSmartHTML(docType, studentId, refId, generatorFn);

    const contentDiv = document.getElementById(contentDivId);
    contentDiv.innerHTML = html;
    // contentDiv.setAttribute('data-doc-ref-id', docId || 'temp'); // removido para evitar confusão se não salvou

    const titleId = contentDivId.replace('content', 'title');
    const titleEl = document.getElementById(titleId);
    if (titleEl) titleEl.textContent = title;

    // --- MUDANÇA: NÃO SALVAR AUTOMATICAMENTE AO VISUALIZAR ---
    // O usuário solicitou que salve APENAS ao assinar.
    // Então comentamos o saveDocumentSnapshot aqui.
    /*
    const signaturesToSave = Object.fromEntries(signatureMap);
    if (!docId) {
        const docRef = await saveDocumentSnapshot(docType, title, html, studentId, { refId, signatures: signaturesToSave });
        contentDiv.setAttribute('data-doc-ref-id', docRef.id);
    } else {
        await saveDocumentSnapshot(docType, title, html, studentId, { refId, signatures: signaturesToSave });
    }
    */

    // Para funcionar o link de assinatura, precisamos garantir que o link use REFID e TYPE
    // E que o checkForRemoteSignParams saiba reconstruir o HTML se não achar no banco.

    // Reanexa os listeners para o novo HTML gerado
    attachDynamicSignatureListeners(
        () => renderDocumentModal(title, contentDivId, docType, studentId, refId, generatorFn, extraData),
        { docType, studentId, refId, generatorFn, title, extraData }
    );
};

// ... (existing helper functions) ...

// --- MODO "PARENT VIEW" (VISÃO DO PAI - LINK SEGURO) ---


// ... restoring original implementations ...

const attachDynamicSignatureListeners = (reRenderCallback, context = {}) => {
    document.querySelectorAll('.signature-interaction-area').forEach(area => {
        area.onclick = (e) => {
            e.stopPropagation();
            const key = area.getAttribute('data-sig-key');
            // Busca o ID do documento renderizado na div pai
            const contentDiv = area.closest('[data-doc-ref-id]'); // Tenta achar wrapper com ID
            // Se não achar, procura container genérico e assume 'temp'
            const currentDocRefId = contentDiv ? contentDiv.getAttribute('data-doc-ref-id') : 'temp';

            // Captura contexto para geração de link
            window.currentDocParams = {
                refId: context.refId || context.title,
                type: context.docType,
                studentId: context.studentId,
                extraData: context.extraData
            };

            openSignaturePad(key, currentDocRefId, async (data) => {
                // 1. ATUALIZA MEMÓRIA LOCAL
                signatureMap.set(key, data);
                showToast("Assinatura coletada! Processando...");

                // 2. LÓGICA DE SALVAMENTO (SAVE ON SIGN)
                // Se é 'temp' ou nulo, CRIAMOS o documento agora.
                // Se já existe, ATUALIZAMOS.

                try {
                    let docRealId = currentDocRefId;
                    const signaturesToSave = Object.fromEntries(signatureMap);

                    // REGENERAR HTML ATUALIZADO (IMPORTANTE: O HTML salvo deve ter a assinatura!)
                    // Mas o 'reRenderCallback' vai gerar o visual novo. 
                    // Precisamos do HTML *string* para salvar.
                    // O generatorFn pode ser chamado novamente.
                    // O generatorFn pode ser chamado novamente.
                    const newHtmlRaw = await generateSmartHTML(context.docType, context.studentId, context.refId, context.generatorFn);
                    // O generateSmartHTML retorna {html, docId}. O html INCLUI as assinaturas do signatureMap (que acabamos de atualizar).
                    // Então 'newHtmlRaw.html' é o que queremos salvar.

                    if (!docRealId || docRealId === 'temp' || docRealId === 'undefined') {
                        // CRIA NOVO
                        console.log("Criando novo documento via assinatura local...");
                        const newDocRef = await saveDocumentSnapshot(context.docType, context.title, newHtmlRaw.html, context.studentId, {
                            refId: context.refId,
                            signatures: signaturesToSave
                        });
                        docRealId = newDocRef.id;
                        showToast("Documento salvo e assinado!");
                    } else {
                        // ATUALIZA EXISTENTE
                        console.log("Atualizando documento existente...", docRealId);
                        await updateDocumentSignatures(docRealId, signatureMap, newHtmlRaw.html);
                        showToast("Assinatura registrada!");
                    }

                    // 3. REFLETE NA UI GLOBAL (SE LISTA ESTIVER VISÍVEL)
                    // Atualiza a lista de documentos em memória se necessário
                    const docIndex = state.documents.findIndex(d => d.id === docRealId);
                    if (docIndex > -1) {
                        state.documents[docIndex].signatures = signaturesToSave;
                        state.documents[docIndex].htmlContent = newHtmlRaw.html;
                    } else {
                        // Se era novo, adiciona? Ou força refresh? 
                        // Melhor não mexer muito no state global complexo aqui, o refresh acontece ao abrir a aba.
                    }

                } catch (err) {
                    console.error("Erro ao salvar assinatura local:", err);
                    showToast("Erro ao salvar assinatura: " + err.message);
                }

                // 4. RE-RENDERIZA A VISUALIZAÇÃO ATUAL
                reRenderCallback();
            });
        };
    });
};


// =================================================================================
// FUNÇÕES DE ABERTURA DE MODAIS (EXPORTADAS)
// =================================================================================

export const openStudentSelectionModal = async (groupId) => {
    const incident = await fetchIncidentById(groupId);
    if (!incident || incident.participantsInvolved.size === 0) return showToast('Incidente não encontrado.');

    const participants = [...incident.participantsInvolved.values()];
    if (participants.length === 1) {
        await openIndividualNotificationModal(incident, participants[0].student);
        return;
    }

    const modal = document.getElementById('student-selection-modal');
    const modalBody = document.getElementById('student-selection-modal-body');
    if (!modal || !modalBody) return;

    modalBody.innerHTML = '';
    participants.forEach(participant => {
        const student = participant.student;
        const btn = document.createElement('button');
        btn.className = 'w-full text-left bg-gray-50 hover:bg-sky-100 p-3 rounded-lg transition border border-gray-200 mb-2';
        btn.innerHTML = `<span class="font-semibold text-sky-800">${student.name}</span><br><span class="text-sm text-gray-600">Turma: ${student.class}</span>`;
        btn.onclick = async () => {
            await openIndividualNotificationModal(incident, student);
            closeModal(modal);
        };
        modalBody.appendChild(btn);
    });
    openModal(modal);
}

export const openIndividualNotificationModal = async (incident, studentObj, specificAttempt = null) => {
    signatureMap.clear();
    const data = incident.records.find(r => r.studentId === studentObj.matricula);
    if (!data) return showToast(`Erro: Registro não encontrado.`);

    const student = await resolveStudentData(studentObj.matricula, data);
    let attemptCount = specificAttempt || (data.contactSucceeded_1 ? (data.contactSucceeded_2 ? 3 : 2) : 1);

    let meetingDate = data[`meetingDate_${attemptCount}`] || (attemptCount === 1 ? data.meetingDate : null);
    let meetingTime = data[`meetingTime_${attemptCount}`] || (attemptCount === 1 ? data.meetingTime : null);
    const uniqueRefId = `${incident.id}_attempt_${attemptCount}`;

    const generator = (dateObj) => {
        const currentDateStr = dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
        const attemptText = `Esta é a <strong>${attemptCount}ª tentativa</strong> de contato formal realizada pela escola.`;
        // CORREÇÃO: Forçar String no ID
        const sigSlots = [{ key: `responsible_${String(student.matricula)}`, role: 'Responsável', name: 'Responsável Legal' }];

        return `
            <div class="space-y-6 text-sm font-serif leading-relaxed text-gray-900">
                ${getReportHeaderHTML(dateObj)}
                <p class="text-right text-sm italic mb-8">${state.config?.city || "Cidade"}, ${currentDateStr}</p>
                <h3 class="text-xl font-bold text-center uppercase border-b-2 border-gray-300 pb-2 mb-6">Notificação de Ocorrência Escolar</h3>
                ${getStudentIdentityCardHTML(student)}
                <p class="text-justify indent-8">Prezados Senhores Pais ou Responsáveis,</p>
                <p class="text-justify indent-8 mt-2">Vimos por meio desta notificá-los sobre um registro disciplinar referente ao(à) aluno(a) acima identificado(a), classificado como <strong>"${formatText(data.occurrenceType)}"</strong>, ocorrido na data de <strong>${formatDate(data.date)}</strong>. ${attemptText}</p>
                <div class="my-6 p-4 bg-gray-50 border-l-4 border-red-500 rounded text-sm font-sans"><p class="font-bold text-red-700 mb-1"><i class="fas fa-exclamation-triangle"></i> Atenção:</p><p class="text-justify text-gray-700">Conforme a Lei de Diretrizes e Bases da Educação (LDB) e o Estatuto da Criança e do Adolescente (ECA), a parceria família-escola é fundamental. O não comparecimento após as tentativas formais de contato poderá acarretar no encaminhamento do caso aos órgãos de proteção.</p></div>
                <p class="text-justify mt-4">Solicitamos o comparecimento urgente de um responsável na coordenação pedagógica para tratar deste assunto na seguinte data:</p>
                ${meetingDate ? `<div class="my-6 mx-auto max-w-sm border-2 border-gray-800 rounded-lg p-4 text-center bg-white shadow-sm break-inside-avoid"><p class="text-xs uppercase tracking-wide text-gray-500 font-bold mb-1">Agendamento</p><div class="text-2xl font-bold text-gray-900">${formatDate(meetingDate)}</div><div class="text-xl font-semibold text-gray-700 mt-1">${formatTime(meetingTime)}</div></div>` : ''}
                ${generateSignaturesGrid(sigSlots)}
            </div>`;
    };

    await renderDocumentModal('Notificação', 'notification-content', 'notificacao', student.matricula, uniqueRefId, generator);
    openModal(dom.notificationModalBackdrop);
};

export const openOccurrenceRecordModal = async (groupId) => {
    signatureMap.clear();
    const incident = await fetchIncidentById(groupId);
    if (!incident || incident.records.length === 0) return showToast('Incidente não encontrado.');

    const mainRecord = incident.records[0];
    const city = state.config?.city || "Cidade";
    const participants = [...incident.participantsInvolved.values()];

    const generator = (dateObj) => {
        const dateString = dateObj.toLocaleDateString('pt-BR', { dateStyle: 'long' });
        const sigSlots = [];
        participants.forEach(p => {
            // CORREÇÃO: Forçar String no ID
            sigSlots.push({ key: `student_${String(p.student.matricula)}`, role: `Aluno (${p.role})`, name: p.student.name });
            sigSlots.push({ key: `responsible_${String(p.student.matricula)}`, role: 'Responsável', name: p.student.name });
        });

        // ... (resto do template HTML da Ata mantido igual) ...
        let html = `
            <div class="space-y-4 text-sm font-serif leading-relaxed text-gray-900">
                ${getReportHeaderHTML(dateObj)}
                <h3 class="text-lg font-bold text-center uppercase mb-6 bg-gray-100 py-2 border rounded">ATA DE REGISTRO DE OCORRÊNCIA Nº ${incident.id}</h3>
                <p class="text-justify indent-8">Aos ${dateString}, foi lavrada a presente ata para registrar os fatos referentes ao incidente classificado como <strong>"${formatText(mainRecord.occurrenceType)}"</strong>.</p>
                <h4 class="font-bold border-b border-gray-300 mt-6 mb-2 uppercase text-xs text-gray-500">1. Descrição do Fato e Envolvidos</h4>
                <div class="bg-gray-50 p-4 rounded border border-gray-200 text-sm font-sans mb-4"><p class="italic text-gray-700">"${formatText(mainRecord.description)}"</p></div>
                <div class="mb-4"><p class="font-bold text-xs uppercase text-gray-500 mb-2">Alunos Envolvidos:</p><div class="grid grid-cols-1 gap-2">${participants.map(p => `<div class="flex items-center gap-2 p-2 border rounded bg-white"><span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${p.role === 'Vítima' ? 'bg-blue-50 text-blue-700 border-blue-200' : p.role === 'Agente' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-gray-50 text-gray-700 border-gray-200'}">${p.role}</span><span class="font-semibold text-gray-800">${p.student.name}</span><span class="text-xs text-gray-500">(${p.student.class})</span></div>`).join('')}</div></div>
                <h4 class="font-bold border-b border-gray-300 mt-6 mb-2 uppercase text-xs text-gray-500">2. Providências Imediatas (Escola)</h4>
                <p class="text-justify bg-gray-50 p-3 rounded border border-gray-200 font-sans text-sm">${formatText(mainRecord.providenciasEscola)}</p>
                <h4 class="font-bold border-b border-gray-300 mt-6 mb-2 uppercase text-xs text-gray-500">3. Histórico de Acompanhamento</h4>`;

        incident.records.forEach(rec => {
            const participant = incident.participantsInvolved.get(rec.studentId);
            const name = participant ? participant.student.name : rec.studentName;
            let timelineItems = [];

            if (rec.meetingDate) timelineItems.push({ date: rec.meetingDate, title: "1ª Convocação Agendada", desc: `Para: ${formatDate(rec.meetingDate)} às ${formatTime(rec.meetingTime)}` });
            for (let i = 1; i <= 3; i++) {
                const succ = rec[`contactSucceeded_${i}`];
                if (succ) {
                    let desc = succ === 'yes' ? `Com: ${rec[`contactPerson_${i}`]}. Prov: ${rec[`providenciasFamilia_${i}`] || ''}` : "Responsável não compareceu/atendeu.";
                    if (succ === 'yes' && (rec[`contactPrints_${i}`] || rec[`contactPrint_${i}`])) desc += getPrintHTML(rec[`contactPrints_${i}`], rec[`contactPrint_${i}`]);
                    timelineItems.push({ date: rec[`contactDate_${i}`], title: `Feedback ${i}ª Tentativa`, desc: desc });
                }
                if (i < 3 && rec[`meetingDate_${i + 1}`]) timelineItems.push({ date: rec[`meetingDate_${i + 1}`], title: `${i + 1}ª Convocação`, desc: `Para: ${formatDate(rec[`meetingDate_${i + 1}`])}` });
            }
            if (rec.oficioNumber) timelineItems.push({ date: rec.ctSentDate, title: "Encaminhamento CT", desc: `Ofício ${rec.oficioNumber}/${rec.oficioYear}` });
            if (rec.ctFeedback) timelineItems.push({ date: null, title: "Devolutiva CT", desc: rec.ctFeedback });
            if (rec.parecerFinal) timelineItems.push({ date: null, title: "Parecer Final", desc: rec.parecerFinal });

            if (timelineItems.length > 0) {
                html += `<div class="mb-4 break-inside-avoid"><p class="font-bold text-sm text-gray-800 mb-2 bg-sky-50 p-1 px-2 rounded inline-block">${name} <span class="text-xs font-normal text-gray-500">(${rec.statusIndividual})</span></p>`;
                timelineItems.forEach(item => { html += `<div class="report-timeline-item ml-2"><div class="report-timeline-dot"></div><p class="text-xs font-bold text-gray-700">${item.title} <span class="font-normal text-gray-500 ml-1">${item.date ? `(${formatDate(item.date)})` : ''}</span></p><div class="text-xs text-gray-600 mt-1">${item.desc}</div></div>`; });
                html += `</div>`;
            }
        });

        html += `<div class="mt-8 pt-4 border-t-2 border-gray-800"><p class="font-bold text-center mb-4">ENCERRAMENTO</p><p class="text-center text-sm">${incident.overallStatus === 'Finalizada' ? 'Ocorrência finalizada.' : 'Ocorrência segue em acompanhamento.'}</p><p class="text-center text-sm mt-2">${city}, ${dateString}.</p></div>${generateSignaturesGrid(sigSlots)}</div>`;
        return html;
    };

    await renderDocumentModal(`Ata Nº ${incident.id}`, 'report-view-content', 'ata', null, incident.id, generator);
    openModal(dom.reportViewModalBackdrop);
};

export const openFichaViewModal = async (id) => {
    signatureMap.clear();
    const record = state.absences.find(abs => abs.id === id);
    if (!record) return showToast('Registro não encontrado.');
    const student = await resolveStudentData(record.studentId, record);

    let absenceCount = record.absenceCount;
    let periodoStart = record.periodoFaltasStart;
    let periodoEnd = record.periodoFaltasEnd;
    if (!absenceCount) {
        const processActions = state.absences.filter(a => a.processId === record.processId);
        const source = processActions.find(a => a.periodoFaltasStart);
        if (source) { absenceCount = source.absenceCount; periodoStart = source.periodoFaltasStart; periodoEnd = source.periodoFaltasEnd; }
    }

    const titleMap = { tentativa_1: "1ª Notificação de Baixa Frequência", tentativa_2: "2ª Notificação de Baixa Frequência", tentativa_3: "3ª Notificação - Pré-Encaminhamento", visita: "Registro de Visita Domiciliar" };
    const title = titleMap[record.actionType] || actionDisplayTitles[record.actionType] || "Documento Busca Ativa";

    const generator = (dateObj) => {
        const currentDateStr = dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
        let bodyContent = '';
        if (record.actionType.startsWith('tentativa')) {
            bodyContent = `<p class="text-justify indent-8">Prezados Responsáveis,</p><p class="text-justify indent-8 mt-2">Comunicamos que o(a) aluno(a) acima identificado(a) atingiu o número de <strong>${formatText(absenceCount)} faltas</strong> no período de ${formatDate(periodoStart)} a ${formatDate(periodoEnd)}, configurando situação de risco escolar.</p><div class="my-4 p-3 bg-yellow-50 border-l-4 border-yellow-500 text-sm font-sans rounded"><p><strong>Fundamentação Legal:</strong> Conforme a LDB (Lei 9.394/96) e o ECA, é dever da família assegurar a frequência escolar.</p></div>${record.meetingDate ? `<p class="text-justify mt-4">Solicitamos comparecimento obrigatório na escola:</p><div class="my-4 mx-auto max-w-xs border border-gray-400 rounded p-3 text-center bg-white shadow-sm"><p class="font-bold text-lg">${formatDate(record.meetingDate)}</p><p class="font-semibold text-gray-700">${formatTime(record.meetingTime)}</p></div>` : `<p class="mt-4 font-bold text-center">Favor comparecer à secretaria da escola com urgência.</p>`}`;
        } else if (record.actionType === 'visita') {
            bodyContent = `<p class="text-justify indent-8">Certifico que, nesta data, foi realizada Visita Domiciliar referente ao aluno(a) supracitado(a).</p><div class="mt-4 p-4 border rounded bg-gray-50 font-sans text-sm"><p><strong>Data da Visita:</strong> ${formatDate(record.visitDate)}</p><p><strong>Agente:</strong> ${formatText(record.visitAgent)}</p><p><strong>Resultado:</strong> ${record.visitSucceeded === 'yes' ? 'Contato Realizado' : 'Sem sucesso'}</p><p class="mt-2"><strong>Observações/Justificativa:</strong></p><p class="italic bg-white p-2 border rounded mt-1">${formatText(record.visitReason)} ${formatText(record.visitObs)}</p></div>`;
        }
        // CORREÇÃO: Forçar String no ID
        const sigSlots = [{ key: `responsible_${String(student.matricula)}`, role: 'Responsável', name: 'Responsável Legal' }];

        return `<div class="space-y-6 text-sm font-serif leading-relaxed text-gray-900">${getReportHeaderHTML(dateObj)}<p class="text-right text-sm italic mb-4">${state.config?.city || "Cidade"}, ${currentDateStr}</p><h3 class="text-xl font-bold text-center uppercase border-b-2 border-gray-300 pb-2 mb-6">${title}</h3>${getStudentIdentityCardHTML(student)}${bodyContent}${generateSignaturesGrid(sigSlots)}</div>`;
    };

    // Prepare extra data for stateless link regeneration
    // Helper to serialize dates
    const safeDate = (d) => {
        if (!d) return null;
        if (d.toDate) return d.toDate().toISOString();
        if (d instanceof Date) return d.toISOString();
        return d;
    };

    const extraData = {
        absenceCount,
        periodoFaltasStart: safeDate(periodoStart),
        periodoFaltasEnd: safeDate(periodoEnd),
        meetingDate: safeDate(record.meetingDate),
        meetingTime: record.meetingTime,
        actionType: record.actionType,
        visitDate: safeDate(record.visitDate),
        visitAgent: record.visitAgent,
        visitSucceeded: record.visitSucceeded,
        visitReason: record.visitReason,
        visitObs: record.visitObs
    };

    await renderDocumentModal(title, 'ficha-view-content', 'notificacao', student.matricula, record.id, generator, extraData);
    openModal(dom.fichaViewModalBackdrop);
};

export const generateAndShowConsolidatedFicha = async (studentId, processId = null) => {
    signatureMap.clear();
    let actions = state.absences.filter(a => a.studentId === studentId);
    if (processId) actions = actions.filter(a => a.processId === processId);
    actions.sort((a, b) => (a.createdAt?.toDate() || 0) - (b.createdAt?.toDate() || 0));

    if (actions.length === 0) return showToast('Nenhuma ação encontrada.');
    const student = await resolveStudentData(studentId, actions[0]);
    const faltasData = actions.find(a => a.periodoFaltasStart) || {};
    const analise = actions.find(a => a.actionType === 'analise');
    const isClosed = !!analise;

    const statusStamp = isClosed
        ? `<div class="absolute top-0 right-0 border-2 border-green-600 text-green-600 font-bold px-2 py-1 transform rotate-12 text-xs uppercase rounded">CONCLUÍDO</div>`
        : `<div class="absolute top-0 right-0 border-2 border-yellow-600 text-yellow-600 font-bold px-2 py-1 transform rotate-12 text-xs uppercase rounded">EM ACOMPANHAMENTO</div>`;

    let timelineHTML = '';
    const formatReturnStatus = (val) => { if (val === 'yes') return `<span class="text-green-700 font-bold uppercase">Sim</span>`; if (val === 'no') return `<span class="text-red-700 font-bold uppercase">Não</span>`; return `<span class="text-gray-400">Pendente</span>`; };

    actions.forEach(act => {
        if (act.meetingDate) timelineHTML += `<div class="report-timeline-item ml-2 break-inside-avoid"><div class="report-timeline-dot"></div><p class="text-sm font-bold text-gray-800">Convocação Agendada</p><p class="text-xs text-gray-600 mt-1">Para: <strong>${formatDate(act.meetingDate)}</strong> às <strong>${formatTime(act.meetingTime)}</strong>.</p></div>`;

        let title = "", desc = "", dateRef = act.createdAt?.toDate(), imgs = "";
        if (act.actionType.startsWith('tentativa')) {
            if (act.contactSucceeded) {
                title = `Registro de Contato (${formatText(actionDisplayTitles[act.actionType])})`;
                dateRef = act.contactDate;
                desc = `<strong>Status:</strong> ${act.contactSucceeded === 'yes' ? "Contato Realizado" : "Sem Sucesso"}.<br>`;
                if (act.contactSucceeded === 'yes') { desc += `<strong>Com quem falou:</strong> ${formatText(act.contactPerson)}.<br><strong>Justificativa:</strong> ${formatText(act.contactReason)}.`; imgs = getPrintHTML(act.contactPrints, act.contactPrint); }
                desc += `<br><strong>Retorno à Escola:</strong> ${formatReturnStatus(act.contactReturned)}`;
            }
        } else if (act.actionType === 'visita') {
            title = "Visita Domiciliar Realizada";
            dateRef = act.visitDate;
            desc = `<strong>Agente:</strong> ${formatText(act.visitAgent)}.<br><strong>Status:</strong> ${act.visitSucceeded === 'yes' ? "Contato Realizado" : "Sem contato"}.<br><strong>Obs:</strong> ${formatText(act.visitReason)} ${formatText(act.visitObs)}.<br><strong>Retorno à Escola:</strong> ${formatReturnStatus(act.visitReturned)}`;
        } else if (act.actionType === 'encaminhamento_ct') {
            title = "Encaminhamento ao Conselho Tutelar";
            dateRef = act.ctSentDate;
            desc = `<strong>Ofício Nº:</strong> ${formatText(act.oficioNumber)}/${formatText(act.oficioYear)}.<br>${act.ctFeedback ? `<strong>Devolutiva:</strong> ${formatText(act.ctFeedback)}` : ''}<br><strong>Retorno:</strong> ${formatReturnStatus(act.ctReturned)}`;
        } else if (act.actionType === 'analise') { title = "Parecer Final"; desc = formatText(act.ctParecer); }

        if (title) timelineHTML += `<div class="report-timeline-item ml-2 break-inside-avoid"><div class="report-timeline-dot" style="background-color: #4b5563;"></div><p class="text-sm font-bold text-gray-800">${title} <span class="font-normal text-xs text-gray-500">(${formatDate(dateRef)})</span></p><div class="text-xs text-gray-600 mt-1 leading-relaxed">${desc}</div>${imgs}</div>`;
    });

    if (!timelineHTML) timelineHTML = '<p class="text-sm text-gray-500 italic pl-4">Nenhuma ação detalhada registrada.</p>';

    const generator = (dateObj) => {
        return `<div class="space-y-6 text-sm font-sans relative">${getReportHeaderHTML()} ${statusStamp} <h3 class="text-xl font-bold text-center uppercase border-b pb-2">Ficha Individual de Busca Ativa</h3> ${getStudentIdentityCardHTML(student)} <div class="bg-gray-50 p-4 rounded border border-gray-200 grid grid-cols-3 gap-4 text-center"><div><p class="text-xs font-bold text-gray-500 uppercase">Total Faltas</p><p class="text-xl font-bold text-red-600">${formatText(faltasData.absenceCount)}</p></div><div><p class="text-xs font-bold text-gray-500 uppercase">Início Período</p><p class="font-semibold">${formatDate(faltasData.periodoFaltasStart)}</p></div><div><p class="text-xs font-bold text-gray-500 uppercase">Fim Período</p><p class="font-semibold">${formatDate(faltasData.periodoFaltasEnd)}</p></div></div> <h4 class="font-bold border-b mt-6 mb-4 uppercase text-xs text-gray-500">Histórico de Acompanhamento (Cronologia)</h4> <div class="pl-2 border-l-2 border-gray-100">${timelineHTML}</div> <div class="signature-block mt-24 pt-8 grid grid-cols-2 gap-8 break-inside-avoid"><div class="text-center"><div class="border-t border-black mb-1"></div><p class="text-xs">Direção</p></div><div class="text-center"><div class="border-t border-black mb-1"></div><p class="text-xs">Coordenação</p></div></div> </div>`;
    };

    await renderDocumentModal("Ficha Consolidada", 'report-view-content', 'ficha_busca_ativa', student.matricula, processId, generator);
    openModal(dom.reportViewModalBackdrop);
};

// FUNÇÃO MESTRE DE OFÍCIO
const generateAndShowGenericOficio = async (data, oficioNum, type, studentObjOverride = null) => {
    signatureMap.clear();
    const studentId = data.studentId;
    const student = await resolveStudentData(studentId, studentObjOverride || data);
    const oficioYear = data.oficioYear || new Date().getFullYear();
    const city = state.config?.city || "Cidade";

    const generator = (dateObj) => {
        const currentDateStr = dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
        let subject = "", contextParagraph = "", tableHTML = "", anexosText = "";

        if (type === 'busca_ativa') {
            subject = "Encaminhamento por Evasão/Infrequência Escolar";
            const actions = state.absences.filter(a => a.processId === data.processId).sort((a, b) => (a.createdAt?.toDate() || 0) - (b.createdAt?.toDate() || 0));
            const faltaInfo = actions.find(a => a.periodoFaltasStart);
            contextParagraph = `O(A) referido(a) aluno(a) encontra-se em situação de risco escolar, apresentando <strong>${formatText(faltaInfo?.absenceCount)} faltas</strong> no período de ${formatDate(faltaInfo?.periodoFaltasStart)} a ${formatDate(faltaInfo?.periodoFaltasEnd)}, sem justificativa legal aceitável.`;
            tableHTML = getAttemptsTableHTML(actions, 'busca_ativa');
            anexosText = "Seguem anexos: Ficha de Matrícula e Ficha de Acompanhamento de Frequência.";
        } else {
            subject = "Encaminhamento por Ocorrência Disciplinar";
            contextParagraph = `Encaminhamos o relatório referente ao incidente ocorrido em <strong>${formatDate(data.date)}</strong>, classificado como <strong>"${formatText(data.occurrenceType)}"</strong>. A escola esgotou suas instâncias pedagógicas de resolução de conflito conforme demonstrado abaixo.`;
            tableHTML = getAttemptsTableHTML(data, 'occurrence');
            anexosText = "Seguem anexos: Ata de Ocorrência e Relatórios Individuais.";
        }

        // Ofícios geralmente não precisam de assinatura do Pai, apenas Gestão (que é padrão no grid)
        return `<div class="space-y-6 text-sm font-serif leading-relaxed text-gray-900"><div>${getReportHeaderHTML(dateObj)}<p class="text-right mt-4">${city}, ${currentDateStr}.</p></div><div class="mt-8 font-bold text-lg">OFÍCIO Nº ${String(oficioNum).padStart(3, '0')}/${oficioYear}</div><div class="mt-4"><p><strong>Ao Ilustríssimo(a) Senhor(a) Conselheiro(a) Tutelar</strong></p><p>Conselho Tutelar de ${city}</p></div><div class="bg-gray-100 p-2 border rounded mt-4 mb-6"><p><strong>Assunto:</strong> ${subject}</p></div><div class="text-justify indent-8"><p>Prezados Senhores,</p><p class="mt-4">Pelo presente, encaminhamos a situação do(a) aluno(a) abaixo qualificado(a), solicitando a intervenção deste órgão para garantia dos direitos da criança/adolescente, visto que os recursos escolares foram esgotados.</p></div>${getStudentIdentityCardHTML(student)}<div class="text-justify indent-8 mt-4">${contextParagraph}</div><p class="mt-4 mb-2 font-bold text-gray-700">Histórico de Tentativas de Solução pela Escola:</p>${tableHTML}<p class="text-justify indent-8 mt-6">Diante do exposto e com base no Art. 56 do Estatuto da Criança e do Adolescente (ECA), submetemos o caso para as devidas providências.</p>${generateSignaturesGrid([])}<div class="mt-8 pt-4 border-t text-xs text-gray-500"><p><strong>Anexos:</strong> ${anexosText}</p></div></div>`;
    };

    await renderDocumentModal(`Ofício Nº ${oficioNum}/${oficioYear}`, 'report-view-content', 'oficio', student.matricula, data.id, generator);
    openModal(dom.reportViewModalBackdrop);
};

export const generateAndShowOficio = async (action, oficioNumber) => {
    return generateAndShowGenericOficio(action, oficioNumber, 'busca_ativa');
};

export const generateAndShowOccurrenceOficio = async (record, studentObj, oficioNumber, oficioYear) => {
    return generateAndShowGenericOficio({ ...record, oficioNumber, oficioYear }, oficioNumber, 'ocorrencia', studentObj);
};

export const generateAndShowGeneralReport = async () => {
    showToast("Gerando relatório...");
    const { startDate, endDate, status, type } = state.filtersOccurrences;
    let rawData = [];
    try { rawData = await getOccurrencesForReport(startDate, endDate, type); } catch (e) { rawData = state.occurrences; }
    const filteredIncidentsMap = getFilteredOccurrences(rawData, state.filtersOccurrences);
    const filteredIncidents = [...filteredIncidentsMap.values()];
    if (filteredIncidents.length === 0) return showToast('Nenhum dado para exibir.');
    const currentDate = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const occurrencesByType = filteredIncidents.reduce((acc, incident) => { const t = incident.records?.[0]?.occurrenceType || 'Outros'; acc[t] = (acc[t] || 0) + 1; return acc; }, {});
    const sortedTypes = Object.entries(occurrencesByType).sort((a, b) => b[1] - a[1]);
    const occurrencesByStatus = filteredIncidents.reduce((acc, incident) => { const s = incident.overallStatus || 'Pendente'; acc[s] = (acc[s] || 0) + 1; return acc; }, {});
    const chartDataByType = { labels: sortedTypes.map(i => i[0]), data: sortedTypes.map(i => i[1]) };
    const chartDataByStatus = { labels: Object.keys(occurrencesByStatus), data: Object.values(occurrencesByStatus) };

    const html = `
        <div class="space-y-6 font-sans text-sm">
            ${getReportHeaderHTML()}
            <h3 class="text-xl font-bold text-center uppercase">Relatório Gerencial de Ocorrências</h3>
            <p class="text-center text-xs text-gray-500">Gerado em: ${currentDate}</p>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center my-6">
                <div class="p-3 bg-gray-50 rounded border"><p class="text-2xl font-bold text-sky-600">${filteredIncidents.length}</p><p class="text-xs uppercase text-gray-500">Total</p></div>
                <div class="p-3 bg-gray-50 rounded border"><p class="text-2xl font-bold text-green-600">${filteredIncidents.filter(i => i.overallStatus === 'Finalizada').length}</p><p class="text-xs uppercase text-gray-500">Resolvidas</p></div>
                <div class="p-3 bg-gray-50 rounded border"><p class="text-2xl font-bold text-yellow-600">${filteredIncidents.filter(i => i.overallStatus !== 'Finalizada').length}</p><p class="text-xs uppercase text-gray-500">Pendentes</p></div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 break-inside-avoid">
                <div class="border rounded-lg p-4 shadow-sm bg-white"><h5 class="font-semibold text-center mb-2">Por Tipo</h5><canvas id="report-chart-by-type"></canvas></div>
                <div class="border rounded-lg p-4 shadow-sm bg-white"><h5 class="font-semibold text-center mb-2">Por Status</h5><canvas id="report-chart-by-status"></canvas></div>
            </div>
            <h4 class="font-bold border-b mt-6 mb-4 uppercase text-xs text-gray-500">Detalhamento</h4>
            <table class="report-table"><thead><tr><th>Data</th><th>Tipo</th><th>Status</th><th>Envolvidos</th></tr></thead><tbody>
                    ${filteredIncidents.map(inc => `<tr><td>${formatDate(inc.records[0].date)}</td><td>${inc.records[0].occurrenceType}</td><td>${inc.overallStatus}</td><td>${[...inc.participantsInvolved.values()].map(p => p.student.name).join(', ')}</td></tr>`).join('')}
                </tbody></table>
            <div class="signature-block mt-24 pt-8 text-center break-inside-avoid"><div class="w-2/3 mx-auto border-t border-black pt-2"><p class="text-sm">Assinatura da Gestão Escolar</p></div></div>
        </div>`;

    document.getElementById('report-view-title').textContent = "Relatório Gerencial";
    document.getElementById('report-view-content').innerHTML = html;
    openModal(dom.reportViewModalBackdrop);

    setTimeout(() => {
        try {
            if (typeof Chart === 'undefined') return;
            new Chart(document.getElementById('report-chart-by-type'), { type: 'bar', data: { labels: chartDataByType.labels, datasets: [{ label: 'Qtd', data: chartDataByType.data, backgroundColor: '#0284c7' }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } } } });
            new Chart(document.getElementById('report-chart-by-status'), { type: 'doughnut', data: { labels: chartDataByStatus.labels, datasets: [{ data: chartDataByStatus.data, backgroundColor: ['#f59e0b', '#10b981', '#6b7280'] }] } });
        } catch (e) { console.error(e); }
    }, 100);
};

export const generateAndShowBuscaAtivaReport = async () => {
    showToast("Gerando relatório...");
    let rawData = [];
    try { rawData = await getAbsencesForReport(state.filtersAbsences.startDate, state.filtersAbsences.endDate); } catch (e) { rawData = state.absences; }
    const grouped = rawData.reduce((acc, a) => { const pid = a.processId || `temp-${a.id}`; if (!acc[pid]) acc[pid] = { id: pid, actions: [], studentName: a.studentName || 'Aluno' }; acc[pid].actions.push(a); return acc; }, {});
    const processes = Object.values(grouped);
    if (processes.length === 0) return showToast('Nenhum processo encontrado.');
    let concluded = 0, active = 0;
    processes.forEach(p => { const isConcluded = p.actions.some(a => a.actionType === 'analise'); isConcluded ? concluded++ : active++; });
    const currentDate = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

    const html = `
        <div class="space-y-6 font-sans text-sm">
            ${getReportHeaderHTML()}
            <h3 class="text-xl font-bold text-center uppercase">Relatório de Busca Ativa</h3>
            <p class="text-center text-xs text-gray-500">Gerado em: ${currentDate}</p>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-4 text-center my-6">
                <div class="p-3 bg-gray-50 rounded border"><p class="text-2xl font-bold text-sky-600">${processes.length}</p><p class="text-xs uppercase text-gray-500">Total Processos</p></div>
                <div class="p-3 bg-gray-50 rounded border"><p class="text-2xl font-bold text-green-600">${concluded}</p><p class="text-xs uppercase text-gray-500">Concluídos</p></div>
                <div class="p-3 bg-gray-50 rounded border"><p class="text-2xl font-bold text-yellow-600">${active}</p><p class="text-xs uppercase text-gray-500">Em Andamento</p></div>
            </div>
            <div class="border rounded-lg p-4 shadow-sm bg-white max-w-md mx-auto break-inside-avoid"><h5 class="font-semibold text-center mb-2">Status dos Processos</h5><canvas id="ba-chart-status"></canvas></div>
            <table class="report-table mt-6"><thead><tr><th>Aluno</th><th>Ações</th><th>Última Ação</th><th>Status</th></tr></thead><tbody>
                    ${processes.map(p => { p.actions.sort((a, b) => (a.createdAt?.toDate() || 0) - (b.createdAt?.toDate() || 0)); const last = p.actions[p.actions.length - 1]; const status = p.actions.some(x => x.actionType === 'analise') ? 'Concluído' : 'Em andamento'; return `<tr><td>${p.studentName}</td><td>${p.actions.length}</td><td>${actionDisplayTitles[last.actionType]}</td><td>${status}</td></tr>`; }).join('')}
                </tbody></table>
            <div class="signature-block mt-24 pt-8 text-center break-inside-avoid"><div class="w-2/3 mx-auto border-t border-black pt-2"><p class="text-sm">Assinatura da Gestão Escolar</p></div></div>
        </div>`;

    document.getElementById('report-view-title').textContent = "Relatório Busca Ativa";
    document.getElementById('report-view-content').innerHTML = html;
    openModal(dom.reportViewModalBackdrop);

    setTimeout(() => {
        try {
            if (typeof Chart === 'undefined') return;
            new Chart(document.getElementById('ba-chart-status'), { type: 'pie', data: { labels: ['Concluído', 'Em Andamento'], datasets: [{ data: [concluded, active], backgroundColor: ['#10b981', '#f59e0b'] }] } });
        } catch (e) { console.error(e); }
    }, 100);
};

export const openHistoryModal = async (groupId) => {
    const incident = await fetchIncidentById(groupId);
    if (!incident) return showToast('Incidente não encontrado.');
    const allHistory = incident.records.flatMap(r => r.history || []).sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
    const historyHTML = allHistory.map(entry => {
        const date = entry.timestamp?.seconds ? new Date(entry.timestamp.seconds * 1000) : new Date();
        return `<div class="flex items-start space-x-4 py-3 border-b"><div class="flex-shrink-0"><i class="fas fa-history text-gray-400"></i></div><div><p class="text-sm font-semibold">${formatText(entry.action)}</p><p class="text-xs text-gray-500">${entry.user} em ${date.toLocaleString()}</p></div></div>`;
    }).join('');
    document.getElementById('history-view-title').textContent = `Histórico`;
    document.getElementById('history-view-subtitle').textContent = `ID: ${groupId}`;
    document.getElementById('history-view-content').innerHTML = historyHTML || '<p class="text-center p-4">Sem histórico.</p>';
    openModal(document.getElementById('history-view-modal-backdrop'));
};

export const openAbsenceHistoryModal = (processId) => {
    const actions = state.absences.filter(a => a.processId === processId);
    if (actions.length === 0) return showToast('Processo não encontrado.');
    const allHistory = actions.flatMap(a => a.history || []).sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
    const historyHTML = allHistory.map(entry => {
        const date = entry.timestamp?.seconds ? new Date(entry.timestamp.seconds * 1000) : new Date();
        return `<div class="flex items-start space-x-4 py-3 border-b"><div class="flex-shrink-0"><i class="fas fa-history text-gray-400"></i></div><div><p class="text-sm font-semibold">${formatText(entry.action)}</p><p class="text-xs text-gray-500">${entry.user} em ${date.toLocaleString()}</p></div></div>`;
    }).join('');
    document.getElementById('history-view-title').textContent = `Histórico Busca Ativa`;
    document.getElementById('history-view-subtitle').textContent = `ID: ${processId}`;
    document.getElementById('history-view-content').innerHTML = historyHTML || '<p class="text-center p-4">Sem histórico.</p>';
    openModal(document.getElementById('history-view-modal-backdrop'));
};
