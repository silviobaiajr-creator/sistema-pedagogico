
// =================================================================================
// ARQUIVO: reports.js
// VERSÃO: 12.0 (Completo - Funções Legadas + Assinatura Lado a Lado + WhatsApp)
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

// --- SEGURANÇA: GERAÇÃO DE HASH ---
const generateIntegrityHash = (content, dateId) => {
    let hash = 0;
    const str = content + (dateId || new Date().toISOString());
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16).toUpperCase().padStart(8, '0');
};

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
        
        document.body.innerHTML = `
            <div id="remote-sign-container" class="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4 font-sans">
                <div class="animate-pulse flex flex-col items-center">
                    <div class="h-12 w-12 bg-sky-200 rounded-full mb-4"></div>
                    <p class="text-gray-600 font-bold">Iniciando ambiente seguro...</p>
                </div>
            </div>`;

        try {
            let docSnapshot = null;
            if (docId) {
                docSnapshot = await getLegalDocumentById(docId);
            } else if (refId && type) {
                docSnapshot = await findDocumentSnapshot(type, studentId, refId);
            }
            
            if (!docSnapshot) {
                document.getElementById('remote-sign-container').innerHTML = `<div class="bg-white p-8 rounded-lg shadow-xl mt-10 text-center"><h1 class="text-2xl font-bold text-red-600 mb-2">Link Inválido</h1><p>Documento não encontrado ou expirado.</p></div>`;
                return;
            }

            const container = document.getElementById('remote-sign-container');
            const targetKey = `responsible_${String(studentId || docSnapshot.studentId)}`;
            
            if (docSnapshot.signatures && docSnapshot.signatures[targetKey]) {
                const sig = docSnapshot.signatures[targetKey];
                const signedDate = new Date(sig.timestamp).toLocaleString();
                
                container.innerHTML = `
                    <div class="w-full max-w-md bg-white shadow-xl rounded-xl overflow-hidden border-t-4 border-green-600 mt-10 mx-auto">
                        <div class="bg-gray-50 p-8 text-center">
                            <div class="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                <i class="fas fa-file-signature text-4xl text-green-600"></i>
                            </div>
                            <h2 class="text-xl font-bold text-gray-800">Documento Já Assinado</h2>
                            <p class="text-sm text-gray-500 mt-2">Este link já foi utilizado para registrar a ciência do responsável.</p>
                        </div>
                        <div class="p-6 border-t border-gray-100 bg-white">
                            <h3 class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Dados do Registro</h3>
                            <div class="space-y-3 text-sm">
                                <div class="flex justify-between border-b border-gray-100 pb-2">
                                    <span class="text-gray-600">Assinado por:</span>
                                    <span class="font-bold text-gray-900">${sig.signerName || 'Não informado'}</span>
                                </div>
                                <div class="flex justify-between border-b border-gray-100 pb-2">
                                    <span class="text-gray-600">Data/Hora:</span>
                                    <span class="text-gray-900">${signedDate}</span>
                                </div>
                                ${sig.photo ? `<div class="mt-4 text-center"><p class="text-xs text-gray-500 mb-1">Registro Biométrico:</p><img src="${sig.photo}" class="w-32 h-32 object-cover rounded-lg mx-auto border-2 border-gray-200 shadow-sm"></div>` : ''}
                            </div>
                        </div>
                    </div>
                `;
                return; 
            }

            // FASE 1: DESAFIO DE IDENTIDADE
            const renderIdentityChallenge = () => {
                container.innerHTML = `
                    <div class="w-full max-w-md bg-white shadow-2xl rounded-xl overflow-hidden">
                        <div class="bg-sky-800 p-6 text-white text-center">
                            <i class="fas fa-shield-alt text-4xl mb-2"></i>
                            <h2 class="text-xl font-bold uppercase">Área Restrita</h2>
                            <p class="text-xs opacity-80 mt-1">Identificação Obrigatória</p>
                        </div>
                        <div class="p-6 md:p-8 space-y-4">
                            <p class="text-sm text-gray-600 text-center mb-4">Para visualizar e assinar o documento, por favor confirme sua identidade.</p>
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Seu Nome Completo</label>
                                <input id="input-signer-name" type="text" class="w-full p-3 border border-gray-300 rounded focus:ring-2 focus:ring-sky-500 outline-none uppercase text-sm" placeholder="Digite seu nome">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Seu CPF</label>
                                <input id="input-signer-cpf" type="tel" class="w-full p-3 border border-gray-300 rounded focus:ring-2 focus:ring-sky-500 outline-none text-sm" placeholder="000.000.000-00" maxlength="14">
                            </div>
                            <button id="btn-access-doc" class="w-full mt-4 bg-sky-600 hover:bg-sky-700 text-white font-bold py-3 px-4 rounded shadow transition transform active:scale-95">CONTINUAR</button>
                        </div>
                    </div>
                `;
                document.getElementById('input-signer-cpf').addEventListener('input', (e) => {
                    let v = e.target.value.replace(/\D/g, "");
                    if(v.length > 11) v = v.slice(0, 11);
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
                    <div class="w-full max-w-3xl bg-white shadow-2xl rounded-xl overflow-hidden mb-8" id="document-capture-area">
                        <div class="bg-green-700 p-4 text-white flex justify-between items-center">
                            <div><h2 class="text-sm font-bold uppercase"><i class="fas fa-file-contract"></i> Documento Liberado</h2><p class="text-[10px] opacity-80">Acesso por: ${identityData.name}</p></div>
                        </div>
                        <div class="p-6 md:p-10 text-sm bg-gray-50 border-b">${docSnapshot.htmlContent}</div>
                        <div class="bg-gray-100 p-6 flex flex-col items-center gap-6 no-print">
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
                    </div>`;

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

                btnSign.onclick = async function() {
                    if (!capturedPhotoBase64) return;
                    this.disabled = true; this.innerHTML = 'Salvando...';
                    const meta = await fetchClientMetadata();
                    const digitalSignature = { type: 'digital_ack', ip: meta.ip, device: meta.userAgent, timestamp: meta.timestamp, signerName: identityData.name, signerCPF: identityData.cpf, photo: capturedPhotoBase64, valid: true };
                    const key = `responsible_${String(studentId || docSnapshot.studentId)}`;
                    const sigMap = new Map(); sigMap.set(key, digitalSignature);
                    const success = await updateDocumentSignatures(docSnapshot.id, sigMap);
                    if (success) {
                        if(remoteStream) remoteStream.getTracks().forEach(t => t.stop());
                        
                        // SUCESSO E WHATSAPP
                        container.innerHTML = `
                            <div class="h-[80vh] flex flex-col items-center justify-center p-4">
                                <div class="bg-white p-8 rounded-2xl shadow-xl text-center max-w-sm w-full">
                                    <div class="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                                        <i class="fas fa-check text-4xl text-green-600"></i>
                                    </div>
                                    <h1 class="text-2xl font-bold text-gray-800 mb-2">Assinado com Sucesso!</h1>
                                    <p class="text-gray-600 mb-6 text-sm">O documento foi validado juridicamente.</p>
                                    
                                    <div class="space-y-3">
                                        <button onclick="window.generateAndSendWhatsapp('${docSnapshot.id}')" class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition">
                                            <i class="fab fa-whatsapp text-xl"></i> Baixar e Abrir WhatsApp
                                        </button>
                                        <button onclick="location.reload()" class="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 px-4 rounded-lg">
                                            Fechar
                                        </button>
                                    </div>
                                </div>
                            </div>`;
                            
                            window.generateAndSendWhatsapp = (dId) => {
                                const msg = `Olá, segue a confirmação de assinatura do documento escolar ID ${dId}.`;
                                window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
                            };
                    } else { alert("Erro ao salvar."); this.disabled = false; }
                };
            };
            renderIdentityChallenge();
        } catch (e) { alert("Erro fatal."); }
    }
};
setTimeout(checkForRemoteSignParams, 500);


// --- LÓGICA DO MODAL DE ASSINATURA ---
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
                    <div class="flex justify-between items-end mb-1"><p class="text-xs font-bold text-gray-600 uppercase">Assinatura</p><div class="flex gap-1"><button id="btn-undo-signature" class="bg-gray-200 px-2 py-0.5 rounded text-[10px] font-bold hover:bg-gray-300"><i class="fas fa-undo"></i></button><button id="btn-clear-signature" class="bg-red-100 text-red-700 px-2 py-0.5 rounded text-[10px] font-bold hover:bg-red-200"><i class="fas fa-trash"></i></button></div></div>
                    <div class="border-2 border-dashed border-gray-400 rounded bg-gray-50 relative touch-none"><canvas id="signature-canvas" class="w-full h-32 cursor-crosshair"></canvas></div>
                </div>
                <div id="content-tab-link" class="hidden">
                    <div id="local-options-container" class="space-y-4">
                        <div class="bg-green-50 border border-green-200 rounded-lg p-4"><h4 class="font-bold text-green-800 text-sm mb-1"><i class="fab fa-whatsapp"></i> Enviar Link</h4><p class="text-xs text-green-700 mb-3">Gere um link para o responsável assinar do próprio celular.</p><div class="bg-white p-2 rounded border border-gray-200 text-[10px] text-gray-500 mb-3 font-mono break-all" id="generated-link-preview">...</div><button id="btn-send-whatsapp" class="w-full bg-green-600 text-white font-bold py-2 rounded shadow text-sm"><i class="fas fa-share"></i> Enviar Link</button></div>
                        <div class="flex items-center justify-center text-gray-400 text-xs font-bold">- OU -</div>
                        <div class="bg-sky-50 border border-sky-200 rounded-lg p-4 text-center"><h4 class="font-bold text-sky-800 text-sm mb-1">Assinar Agora (Biometria)</h4><p class="text-xs text-sky-700 mb-3">Coleta Nome, CPF e Selfie.</p><button id="btn-start-local-flow" class="w-full bg-sky-600 text-white font-bold py-3 rounded shadow"><i class="fas fa-user-check"></i> INICIAR COLETA</button></div>
                    </div>
                    <div id="local-identity-container" class="hidden space-y-3"><h4 class="font-bold text-gray-700 text-center border-b pb-2">Identificação</h4><div><label class="text-xs font-bold text-gray-500">Nome Completo</label><input id="local-signer-name" type="text" class="w-full border p-2 rounded uppercase text-sm"></div><div><label class="text-xs font-bold text-gray-500">CPF</label><input id="local-signer-cpf" type="tel" class="w-full border p-2 rounded text-sm" maxlength="14"></div><div class="flex gap-2 mt-4"><button id="btn-cancel-local" class="flex-1 bg-gray-200 text-gray-700 py-2 rounded text-xs font-bold">Voltar</button><button id="btn-next-local" class="flex-1 bg-sky-600 text-white py-2 rounded text-xs font-bold">Próximo</button></div></div>
                    <div id="local-selfie-container" class="hidden flex flex-col items-center"><h4 class="font-bold text-gray-700 text-center mb-2">Validação Biométrica</h4><div class="relative w-full h-48 bg-black rounded-lg overflow-hidden flex items-center justify-center mb-3"><video id="local-video" autoplay playsinline class="w-full h-full object-cover transform scale-x-[-1]"></video><canvas id="local-canvas" class="hidden"></canvas><img id="local-photo-result" class="absolute inset-0 w-full h-full object-cover hidden transform scale-x-[-1]"></div><div class="flex gap-2 w-full mb-3"><button id="btn-local-take" class="flex-1 bg-green-600 text-white py-2 rounded text-xs font-bold"><i class="fas fa-camera"></i> Capturar</button><button id="btn-local-retake" class="hidden flex-1 bg-yellow-500 text-white py-2 rounded text-xs font-bold"><i class="fas fa-redo"></i> Refazer</button></div><button id="btn-finish-local" disabled class="w-full bg-gray-400 text-white py-3 rounded font-bold shadow cursor-not-allowed">CONFIRMAR ASSINATURA</button><button id="btn-back-to-identity" class="mt-2 text-xs text-gray-500 underline">Voltar</button></div>
                </div>
            </div>
            <div class="flex justify-between items-center bg-gray-50 p-3 border-t"><button id="btn-cancel-signature" class="px-4 py-2 rounded text-gray-600 hover:bg-gray-200 text-xs font-bold">Cancelar</button><button id="btn-confirm-signature" class="px-6 py-2 rounded bg-gray-900 text-white font-bold hover:bg-gray-800 shadow text-xs">Salvar Desenho</button></div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    setupSignaturePadEvents();
};

const setupSignaturePadEvents = () => {
    const modal = document.getElementById('signature-pad-modal');
    const canvas = document.getElementById('signature-canvas');
    const ctx = canvas.getContext('2d');
    
    // Abas
    const tabDraw = document.getElementById('tab-draw');
    const tabLink = document.getElementById('tab-link');
    const contentDraw = document.getElementById('content-tab-draw');
    const contentLink = document.getElementById('content-tab-link');
    const btnConfirm = document.getElementById('btn-confirm-signature');

    // Fluxo Local
    const localOptions = document.getElementById('local-options-container');
    const localIdentity = document.getElementById('local-identity-container');
    const localSelfie = document.getElementById('local-selfie-container');
    
    const switchTab = (tab) => {
        if(tab === 'draw') {
            contentDraw.classList.remove('hidden'); contentLink.classList.add('hidden');
            tabDraw.className = "flex-1 py-3 text-sm font-bold text-sky-700 border-b-2 border-sky-600 bg-white transition";
            tabLink.className = "flex-1 py-3 text-sm font-bold text-gray-500 hover:text-sky-600 transition";
            btnConfirm.classList.remove('hidden');
            startCamera(); 
            const rect = canvas.parentElement.getBoundingClientRect();
            if(rect.width > 0) { canvas.width = rect.width; canvas.height = 128; redrawCanvas(); }
        } else {
            contentDraw.classList.add('hidden'); contentLink.classList.remove('hidden');
            tabLink.className = "flex-1 py-3 text-sm font-bold text-sky-700 border-b-2 border-sky-600 bg-white transition";
            tabDraw.className = "flex-1 py-3 text-sm font-bold text-gray-500 hover:text-sky-600 transition";
            btnConfirm.classList.add('hidden');
            stopCameraStream(); 
            localOptions.classList.remove('hidden'); localIdentity.classList.add('hidden'); localSelfie.classList.add('hidden');
            if (currentDocumentIdForRemote) {
                const baseUrl = window.location.href.split('?')[0];
                const fullLink = `${baseUrl}?mode=sign&docId=${currentDocumentIdForRemote}&type=notificacao&student=${currentDocumentKeyForRemote.replace('responsible_', '')}`;
                document.getElementById('generated-link-preview').innerText = fullLink;
                document.getElementById('btn-send-whatsapp').onclick = () => window.open(`https://wa.me/?text=${encodeURIComponent(`Link para assinatura: ${fullLink}`)}`, '_blank');
            }
        }
    };

    tabDraw.onclick = () => switchTab('draw');
    tabLink.onclick = () => switchTab('link');

    // Fluxo Local Presencial
    let localStream = null;
    let localCapturedPhoto = null;

    document.getElementById('btn-start-local-flow').onclick = () => { localOptions.classList.add('hidden'); localIdentity.classList.remove('hidden'); };
    document.getElementById('btn-cancel-local').onclick = () => { localIdentity.classList.add('hidden'); localOptions.classList.remove('hidden'); };
    
    document.getElementById('local-signer-cpf').addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, "");
        if(v.length > 11) v = v.slice(0, 11);
        v = v.replace(/(\d{3})(\d)/, "$1.$2"); v = v.replace(/(\d{3})(\d)/, "$1.$2"); v = v.replace(/(\d{3})(\d{1,2})$/, "$1-$2");
        e.target.value = v;
    });

    document.getElementById('btn-next-local').onclick = async () => {
        const name = document.getElementById('local-signer-name').value.trim();
        const cpf = document.getElementById('local-signer-cpf').value.trim();
        if (name.length < 5 || cpf.length < 11) return alert("Preencha Nome e CPF corretamente.");
        
        localIdentity.classList.add('hidden'); localSelfie.classList.remove('hidden');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
            localStream = stream;
            document.getElementById('local-video').srcObject = stream;
        } catch(e) { alert("Erro ao abrir câmera."); }
    };

    document.getElementById('btn-back-to-identity').onclick = () => {
        if(localStream) localStream.getTracks().forEach(t=>t.stop());
        localSelfie.classList.add('hidden'); localIdentity.classList.remove('hidden');
    };

    document.getElementById('btn-local-take').onclick = () => {
        const vid = document.getElementById('local-video'); const can = document.getElementById('local-canvas'); const img = document.getElementById('local-photo-result');
        can.width = vid.videoWidth; can.height = vid.videoHeight;
        const ctxL = can.getContext('2d'); ctxL.translate(can.width, 0); ctxL.scale(-1, 1); ctxL.drawImage(vid, 0, 0);
        localCapturedPhoto = can.toDataURL('image/jpeg', 0.5);
        img.src = localCapturedPhoto; img.classList.remove('hidden');
        document.getElementById('btn-local-take').classList.add('hidden'); document.getElementById('btn-local-retake').classList.remove('hidden');
        const btnFinish = document.getElementById('btn-finish-local');
        btnFinish.disabled = false; btnFinish.classList.remove('bg-gray-400', 'cursor-not-allowed'); btnFinish.classList.add('bg-sky-600', 'hover:bg-sky-700');
    };

    document.getElementById('btn-local-retake').onclick = () => {
        localCapturedPhoto = null; document.getElementById('local-photo-result').classList.add('hidden');
        document.getElementById('btn-local-take').classList.remove('hidden'); document.getElementById('btn-local-retake').classList.add('hidden');
        const btnFinish = document.getElementById('btn-finish-local');
        btnFinish.disabled = true; btnFinish.classList.add('bg-gray-400', 'cursor-not-allowed'); btnFinish.classList.remove('bg-sky-600', 'hover:bg-sky-700');
    };

    document.getElementById('btn-finish-local').onclick = async () => {
        if(!localCapturedPhoto) return;
        const name = document.getElementById('local-signer-name').value.trim();
        const cpf = document.getElementById('local-signer-cpf').value.trim();
        showToast("Registrando...");
        const meta = await fetchClientMetadata();
        const digitalData = { type: 'digital_ack', ip: meta.ip, device: meta.userAgent, timestamp: meta.timestamp, signerName: name, signerCPF: cpf, photo: localCapturedPhoto, valid: true };
        if(localStream) localStream.getTracks().forEach(t=>t.stop());
        if(currentStream) currentStream.getTracks().forEach(t=>t.stop());
        modal.classList.add('hidden'); modal.classList.remove('flex');
        if (modal._onConfirmCallback) modal._onConfirmCallback(digitalData);
    };

    // Canvas Desenho
    const btnTake = document.getElementById('btn-take-photo'); const btnRetake = document.getElementById('btn-retake-photo');
    const video = document.getElementById('camera-preview'); const photoResult = document.getElementById('photo-result'); const photoCanvas = document.getElementById('photo-canvas');
    let capturedPhotoData = null;

    btnTake.onclick = () => {
        if (!currentStream) return showToast("Câmera desligada.");
        photoCanvas.width = video.videoWidth; photoCanvas.height = video.videoHeight;
        photoCanvas.getContext('2d').drawImage(video, 0, 0);
        capturedPhotoData = photoCanvas.toDataURL('image/jpeg', 0.6);
        photoResult.src = capturedPhotoData; photoResult.classList.remove('hidden');
        btnTake.classList.add('hidden'); btnRetake.classList.remove('hidden');
    };

    btnRetake.onclick = () => { capturedPhotoData = null; photoResult.classList.add('hidden'); btnTake.classList.remove('hidden'); btnRetake.classList.add('hidden'); };

    const redrawCanvas = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#000';
        savedPaths.forEach(path => { ctx.beginPath(); if(path.length) { ctx.moveTo(path[0].x, path[0].y); path.forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke(); } });
    };

    let isDrawing = false;
    const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: (clientX - rect.left)*(canvas.width/rect.width), y: (clientY - rect.top)*(canvas.height/rect.height) };
    };

    canvas.addEventListener('mousedown', (e) => { isDrawing=true; currentPath=[getPos(e)]; ctx.beginPath(); ctx.moveTo(currentPath[0].x, currentPath[0].y); });
    canvas.addEventListener('mousemove', (e) => { if(!isDrawing) return; const p = getPos(e); currentPath.push(p); ctx.lineTo(p.x, p.y); ctx.stroke(); });
    canvas.addEventListener('mouseup', () => { if(isDrawing){ isDrawing=false; savedPaths.push([...currentPath]); } });
    canvas.addEventListener('touchstart', (e) => { e.preventDefault(); isDrawing=true; currentPath=[getPos(e)]; ctx.beginPath(); ctx.moveTo(currentPath[0].x, currentPath[0].y); }, {passive: false});
    canvas.addEventListener('touchmove', (e) => { e.preventDefault(); if(!isDrawing) return; const p=getPos(e); currentPath.push(p); ctx.lineTo(p.x, p.y); ctx.stroke(); }, {passive: false});
    canvas.addEventListener('touchend', (e) => { if(isDrawing){ isDrawing=false; savedPaths.push([...currentPath]); } });

    document.getElementById('btn-undo-signature').onclick = () => { savedPaths.pop(); redrawCanvas(); };
    document.getElementById('btn-clear-signature').onclick = () => { savedPaths=[]; currentPath=[]; ctx.clearRect(0,0,canvas.width,canvas.height); };

    btnConfirm.onclick = () => {
        const signatureData = canvas.toDataURL('image/png');
        const evidenceData = !photoResult.classList.contains('hidden') ? photoResult.src : null;
        stopCameraStream();
        modal.classList.add('hidden'); modal.classList.remove('flex');
        if (modal._onConfirmCallback) modal._onConfirmCallback({ signature: signatureData, photo: evidenceData });
    };

    document.getElementById('btn-cancel-signature').onclick = () => { stopCameraStream(); if(localStream) localStream.getTracks().forEach(t=>t.stop()); modal.classList.add('hidden'); modal.classList.remove('flex'); };
};

const startCamera = async () => { try { const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } }); currentStream = stream; document.getElementById('camera-preview').srcObject = stream; } catch(e) { console.error(e); } };
const stopCameraStream = () => { if(currentStream) currentStream.getTracks().forEach(t=>t.stop()); currentStream=null; };

const openSignaturePad = (key, docRefId, onConfirm) => {
    ensureSignatureModalExists();
    const modal = document.getElementById('signature-pad-modal');
    modal._onConfirmCallback = onConfirm;
    currentDocumentKeyForRemote = key; currentDocumentIdForRemote = docRefId; savedPaths = []; currentPath = [];
    document.getElementById('tab-draw').click(); 
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
        if (isVideo(src)) return `<div class="text-center border rounded p-2"><p class="text-xs mb-1">Vídeo ${idx+1}</p><video src="${src}" controls class="max-w-full h-auto max-h-[250px]"></video></div>`;
        if (isAudio(src)) return `<div class="text-center border rounded p-2"><p class="text-xs mb-1">Áudio ${idx+1}</p><audio src="${src}" controls class="w-full"></audio></div>`;
        return `<div class="text-center"><img src="${src}" class="max-w-full h-auto max-h-[250px] border rounded shadow-sm object-contain bg-white mx-auto" alt="Anexo ${idx+1}"><p class="text-[10px] text-gray-500 mt-1">Anexo ${idx+1}</p></div>`;
    }).join('');
    return `<div class="mt-3 mb-3 p-3 border border-gray-200 rounded bg-white break-inside-avoid"><p class="text-xs font-bold text-gray-500 mb-2 border-b pb-1"><i class="fas fa-paperclip"></i> Evidências / Anexos:</p><div class="${gridClass}">${imgsHtml}</div></div>`;
};

const getAttemptsTableHTML = (records, type = 'occurrence') => {
    let attempts = [];
    if (type === 'occurrence') {
        const rec = records; 
        for (let i = 1; i <= 3; i++) {
            const mDate = (i===1) ? (rec.meetingDate || rec.meetingDate_1) : rec[`meetingDate_${i}`];
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
             attempts.push({ etapa: `${idx+1}ª Tentativa`, data: formatDate(mDate), status: status });
        });
        if (visitAction) {
             let vStatus = "Realizada";
             if(visitAction.visitSucceeded === 'no') vStatus = "Sem Contato na Visita";
             attempts.push({ etapa: "Visita Domiciliar", data: formatDate(visitAction.visitDate), status: vStatus });
        }
    }
    if (attempts.length === 0) return '<p class="text-sm italic text-gray-500 my-2">Nenhuma tentativa formal registrada.</p>';
    const rows = attempts.map(a => `<tr><td>${a.etapa}</td><td>${a.data}</td><td>${a.status}</td></tr>`).join('');
    return `<table class="report-table"><thead><tr><th style="width: 30%">Ação</th><th style="width: 25%">Data</th><th>Resultado</th></tr></thead><tbody>${rows}</tbody></table>`;
};

// --- VISUAL ASSINATURAS (ATUALIZADO LADO A LADO) ---
const getSingleSignatureBoxHTML = (key, roleTitle, nameSubtitle, sigData) => {
    let content = '';
    // Digital com Biometria
    if (sigData && sigData.type === 'digital_ack') {
        content = `
            <div class="flex-1 p-2 flex flex-col justify-between overflow-hidden">
                <div class="overflow-y-auto">
                    <p class="font-bold uppercase text-[10px] text-green-800 leading-tight">${roleTitle}</p>
                    <p class="text-[9px] text-green-700 font-semibold mb-1 truncate">${nameSubtitle}</p>
                    <div class="text-[8px] text-gray-700 leading-snug">
                        ${sigData.signerName ? `<b>Nome:</b> ${sigData.signerName}<br>` : ''}
                        <b>CPF:</b> ${sigData.signerCPF || '***'}<br>
                        <b>IP:</b> ${sigData.ip || 'N/A'}<br>
                        ${new Date(sigData.timestamp).toLocaleString()}
                    </div>
                </div>
                <div class="bg-green-500 text-white text-[8px] px-2 py-0.5 rounded w-fit mt-1"><i class="fas fa-check"></i> Válido</div>
            </div>
            ${sigData.photo ? `<div class="w-20 min-w-[30%] border-l border-green-200"><img src="${sigData.photo}" class="w-full h-full object-cover"></div>` : ''}`;
        return `<div class="signature-slot border-green-500 bg-green-50 flex flex-row" data-sig-key="${key}">${content}</div>`;
    } 
    // Desenhada
    else if (sigData && (sigData.signature || typeof sigData === 'string')) {
        const img = sigData.signature || sigData;
        content = `
             <div class="w-full h-24 flex items-center justify-center bg-white"><img src="${img}" class="max-h-20 object-contain mix-blend-multiply" /></div>
             <div class="border-t border-gray-300 w-full p-2 text-center bg-gray-50">
                <p class="text-[9px] font-bold uppercase leading-none">${roleTitle}</p>
                <p class="text-[8px] text-gray-500 truncate">${nameSubtitle}</p>
            </div>`;
        return `<div class="signature-slot cursor-pointer border-gray-400" data-sig-key="${key}">${content}</div>`;
    } 
    // Vazio
    else {
        content = `
            <div class="flex-1 flex flex-col items-center justify-center text-gray-400 p-4">
                <i class="fas fa-fingerprint text-2xl mb-1 opacity-30"></i>
                <p class="text-[9px] uppercase font-bold text-center text-gray-400">Assinar</p>
            </div>
            <div class="border-t border-gray-200 w-full p-2 text-center bg-gray-50">
                <p class="text-[9px] font-bold uppercase text-gray-500">${roleTitle}</p>
                <p class="text-[8px] text-gray-400 truncate">${nameSubtitle}</p>
            </div>`;
        return `<div class="signature-slot border-dashed cursor-pointer hover:bg-gray-100 transition signature-interaction-area" data-sig-key="${key}">${content}</div>`;
    }
};

const generatePairedSignaturesHTML = (studentSlot, parentSlot) => {
    const studentHTML = getSingleSignatureBoxHTML(studentSlot.key, studentSlot.role, studentSlot.name, signatureMap.get(studentSlot.key));
    const parentHTML = getSingleSignatureBoxHTML(parentSlot.key, parentSlot.role, parentSlot.name, signatureMap.get(parentSlot.key));
    return `
        <div class="signatures-wrapper">
            <h5 class="text-[10px] font-bold uppercase text-gray-500 mb-2 border-b border-gray-300 pb-1">Assinaturas / Ciência</h5>
            <div class="signature-pair">
                ${studentHTML}
                ${parentHTML}
            </div>
            <div class="mt-4 flex justify-center">
                <div class="w-1/3 text-center">
                    <div class="border-b border-black mb-1 h-8"></div>
                    <p class="text-[9px] uppercase font-bold">Coordenação Pedagógica</p>
                </div>
            </div>
        </div>`;
};

// --- GERAÇÃO DE RODAPÉ DE SEGURANÇA ---
const getReportFooterHTML = (docId, hash) => {
    return `
        <div class="security-footer">
            <div class="flex justify-between items-center px-4">
                <span>ID: ${docId}</span>
                <span>Hash: <span class="security-hash">${hash}</span></span>
                <span>Pág. 1/1</span>
            </div>
            <div class="text-[8px] text-gray-400 mt-1">
                Documento gerado eletronicamente pelo Sistema Pedagógico. A autenticidade pode ser verificada junto à secretaria escolar.
            </div>
        </div>`;
};

// --- FUNÇÃO CENTRAL DE RENDERIZAÇÃO ---
async function generateSmartHTML(docType, studentId, refId, htmlGeneratorFn) {
    const existingDoc = await findDocumentSnapshot(docType, studentId, refId);
    
    // Atualiza mapa local (prioridade para a sessão atual se tiver, senão carrega do banco)
    if (existingDoc && existingDoc.signatures) {
        Object.entries(existingDoc.signatures).forEach(([k, v]) => {
             if (!signatureMap.has(k)) {
                 signatureMap.set(k, v);
             }
        });
    }
    
    const newDate = existingDoc?.createdAt?.toDate() || new Date();
    // Gera HTML principal
    let html = htmlGeneratorFn(newDate);
    
    // Adiciona Rodapé de Segurança
    const hash = generateIntegrityHash(html, existingDoc?.id || refId);
    html += getReportFooterHTML(existingDoc?.id || 'NOVO', hash);

    return { html, docId: existingDoc?.id };
}

const renderDocumentModal = async (title, contentDivId, docType, studentId, refId, generatorFn) => {
    const { html, docId } = await generateSmartHTML(docType, studentId, refId, generatorFn);
    
    const contentDiv = document.getElementById(contentDivId);
    contentDiv.innerHTML = html;
    contentDiv.setAttribute('data-doc-ref-id', docId || 'temp');
    
    const titleId = contentDivId.replace('content', 'title');
    const titleEl = document.getElementById(titleId);
    if(titleEl) titleEl.textContent = title;
    
    // Salva silenciosamente se houver assinaturas novas
    const signaturesToSave = Object.fromEntries(signatureMap);
    
    if (!docId) {
        const docRef = await saveDocumentSnapshot(docType, title, html, studentId, { refId, signatures: signaturesToSave });
        contentDiv.setAttribute('data-doc-ref-id', docRef.id);
    } else {
        if (signatureMap.size > 0) {
            await saveDocumentSnapshot(docType, title, html, studentId, { refId, signatures: signaturesToSave });
        }
    }

    // Reanexa os listeners para o novo HTML gerado
    attachDynamicSignatureListeners(() => renderDocumentModal(title, contentDivId, docType, studentId, refId, generatorFn));
};

const attachDynamicSignatureListeners = (reRenderCallback) => {
    document.querySelectorAll('.signature-interaction-area').forEach(area => {
        area.onclick = (e) => {
            e.stopPropagation(); 
            const key = area.getAttribute('data-sig-key');
            const contentDiv = area.closest('[data-doc-ref-id]');
            const currentDocRefId = contentDiv ? contentDiv.getAttribute('data-doc-ref-id') : 'temp';

            openSignaturePad(key, currentDocRefId, (data) => {
                signatureMap.set(key, data);
                showToast("Assinatura coletada! Atualizando visualização...");
                reRenderCallback();
            });
        };
    });
};

// =================================================================================
// FUNÇÕES DE RELATÓRIO ESPECÍFICAS (MODIFICADAS PARA LADO A LADO)
// =================================================================================

export const openOccurrenceRecordModal = async (groupId) => {
    signatureMap.clear();
    const incident = await fetchIncidentById(groupId);
    if (!incident || incident.records.length === 0) return showToast('Incidente não encontrado.');

    const mainRecord = incident.records[0]; 
    const city = state.config?.city || "Cidade";
    
    // Gera blocos repetidos para cada aluno envolvido
    const participants = [...incident.participantsInvolved.values()];

    const generator = (dateObj) => {
        const dateString = dateObj.toLocaleDateString('pt-BR', {dateStyle:'long'});
        
        let html = `
            <div class="font-sans text-sm text-gray-900">
                ${getReportHeaderHTML(dateObj)}
                <h3 class="text-center font-bold uppercase text-base border-b border-black pb-2 mb-4">ATA DE OCORRÊNCIA Nº ${incident.id}</h3>
                
                <div class="text-justify mb-4">
                    <p>Aos ${dateString}, registra-se o fato classificado como <strong>"${formatText(mainRecord.occurrenceType)}"</strong>.</p>
                </div>

                <div class="mb-4 border p-2 rounded">
                    <p class="font-bold text-xs uppercase mb-1">Descrição do Fato:</p>
                    <p class="italic text-gray-700 text-sm">${formatText(mainRecord.description)}</p>
                </div>

                <div class="mb-4">
                    <p class="font-bold text-xs uppercase mb-1">Providências da Escola:</p>
                    <p class="text-sm">${formatText(mainRecord.providenciasEscola)}</p>
                </div>
        `;

        // Loop de Assinaturas
        participants.forEach(p => {
            const studentSlot = { key: `student_${String(p.student.matricula)}`, role: `Aluno (${p.role})`, name: p.student.name };
            const parentSlot = { key: `responsible_${String(p.student.matricula)}`, role: 'Responsável Legal', name: 'Assinatura' };
            
            html += `
                <div class="mt-6 border-t pt-4 break-inside-avoid">
                    <p class="font-bold text-sm bg-gray-100 p-1 mb-2">Envolvido: ${p.student.name}</p>
                    ${generatePairedSignaturesHTML(studentSlot, parentSlot)}
                </div>
            `;
        });

        html += `</div>`;
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

    const titleMap = { tentativa_1: "1ª Notificação de Frequência", tentativa_2: "2ª Notificação de Frequência", tentativa_3: "3ª Notificação (Pré-Conselho)", visita: "Relatório de Visita" };
    const title = titleMap[record.actionType] || "Documento de Acompanhamento";

    const generator = (dateObj) => {
        const currentDateStr = dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
        
        const studentSlot = { key: `student_${String(student.matricula)}`, role: 'Aluno', name: student.name };
        const parentSlot = { key: `responsible_${String(student.matricula)}`, role: 'Responsável', name: 'Assinatura' };

        return `
            <div class="font-sans text-sm text-gray-900">
                ${getReportHeaderHTML(dateObj)}
                <h3 class="text-center font-bold uppercase text-base border-b border-black pb-2 mb-4">${title}</h3>
                <p class="text-right text-xs italic mb-4">${state.config?.city}, ${currentDateStr}</p>
                
                ${getStudentIdentityCardHTML(student)}
                
                <div class="my-6 p-4 border rounded bg-white text-justify">
                    <p>Comunicamos que o aluno registrou ocorrência/ausência relevante na data de <strong>${formatDate(record.createdAt)}</strong>.</p>
                    ${record.absenceCount ? `<p class="mt-2">Total de Faltas: <strong>${record.absenceCount}</strong></p>` : ''}
                    <p class="mt-2">Solicitamos o comparecimento do responsável.</p>
                </div>

                ${generatePairedSignaturesHTML(studentSlot, parentSlot)}
            </div>`;
    };

    await renderDocumentModal(title, 'ficha-view-content', 'notificacao', student.matricula, record.id, generator);
    openModal(dom.fichaViewModalBackdrop);
};

// =================================================================================
// FUNÇÕES RESTAURADAS (GRÁFICOS, OFÍCIOS, HISTÓRICO)
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
    // Redireciona para a Ficha View Modal com suporte a assinatura lado a lado
    // mas precisamos encontrar o registro específico do aluno
    const data = incident.records.find(r => r.studentId === studentObj.matricula);
    if (!data) return showToast(`Erro: Registro não encontrado.`);
    
    // Aqui usamos a lógica da Ficha, mas adaptada para Notificação Individual da Ocorrência
    // Como openFichaViewModal espera um ID de 'absences', vamos criar um wrapper customizado
    // Ou melhor: Vamos adaptar openOccurrenceRecordModal para gerar apenas para UM aluno se chamado aqui
    // Mas a notificação de ocorrência é diferente da Ata.
    
    signatureMap.clear();
    const student = await resolveStudentData(studentObj.matricula, data);
    let attemptCount = specificAttempt || (data.contactSucceeded_1 ? (data.contactSucceeded_2 ? 3 : 2) : 1);
    let meetingDate = data[`meetingDate_${attemptCount}`] || (attemptCount === 1 ? data.meetingDate : null);
    let meetingTime = data[`meetingTime_${attemptCount}`] || (attemptCount === 1 ? data.meetingTime : null);
    
    const generator = (dateObj) => {
        const currentDateStr = dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
        const attemptText = `Esta é a <strong>${attemptCount}ª tentativa</strong> de contato formal realizada pela escola.`;
        
        const studentSlot = { key: `student_${String(student.matricula)}`, role: 'Aluno', name: student.name };
        const parentSlot = { key: `responsible_${String(student.matricula)}`, role: 'Responsável', name: 'Assinatura' };

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
                ${generatePairedSignaturesHTML(studentSlot, parentSlot)}
            </div>`;
    };

    await renderDocumentModal('Notificação', 'notification-content', 'notificacao', student.matricula, `${incident.id}_attempt_${attemptCount}`, generator);
    openModal(dom.notificationModalBackdrop);
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
                if(act.contactSucceeded === 'yes') { desc += `<strong>Com quem falou:</strong> ${formatText(act.contactPerson)}.<br><strong>Justificativa:</strong> ${formatText(act.contactReason)}.`; imgs = getPrintHTML(act.contactPrints, act.contactPrint); }
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
        // Para Ficha Consolidada, mantemos o bloco antigo de assinaturas (Gestão)
        // pois é um documento interno, mas podemos adaptar se quiser.
        // Vou manter o padrão antigo para este relatório específico pois é um relatório de gestão.
        return `<div class="space-y-6 text-sm font-sans relative">${getReportHeaderHTML(dateObj)} ${statusStamp} <h3 class="text-xl font-bold text-center uppercase border-b pb-2">Ficha Individual de Busca Ativa</h3> ${getStudentIdentityCardHTML(student)} <div class="bg-gray-50 p-4 rounded border border-gray-200 grid grid-cols-3 gap-4 text-center"><div><p class="text-xs font-bold text-gray-500 uppercase">Total Faltas</p><p class="text-xl font-bold text-red-600">${formatText(faltasData.absenceCount)}</p></div><div><p class="text-xs font-bold text-gray-500 uppercase">Início Período</p><p class="font-semibold">${formatDate(faltasData.periodoFaltasStart)}</p></div><div><p class="text-xs font-bold text-gray-500 uppercase">Fim Período</p><p class="font-semibold">${formatDate(faltasData.periodoFaltasEnd)}</p></div></div> <h4 class="font-bold border-b mt-6 mb-4 uppercase text-xs text-gray-500">Histórico de Acompanhamento (Cronologia)</h4> <div class="pl-2 border-l-2 border-gray-100">${timelineHTML}</div> <div class="signature-block mt-24 pt-8 grid grid-cols-2 gap-8 break-inside-avoid"><div class="text-center"><div class="border-t border-black mb-1"></div><p class="text-xs">Direção</p></div><div class="text-center"><div class="border-t border-black mb-1"></div><p class="text-xs">Coordenação</p></div></div> </div>`;
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
            const actions = state.absences.filter(a => a.processId === data.processId).sort((a,b) => (a.createdAt?.toDate()||0) - (b.createdAt?.toDate()||0));
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
        
        return `<div class="space-y-6 text-sm font-serif leading-relaxed text-gray-900"><div>${getReportHeaderHTML(dateObj)}<p class="text-right mt-4">${city}, ${currentDateStr}.</p></div><div class="mt-8 font-bold text-lg">OFÍCIO Nº ${String(oficioNum).padStart(3, '0')}/${oficioYear}</div><div class="mt-4"><p><strong>Ao Ilustríssimo(a) Senhor(a) Conselheiro(a) Tutelar</strong></p><p>Conselho Tutelar de ${city}</p></div><div class="bg-gray-100 p-2 border rounded mt-4 mb-6"><p><strong>Assunto:</strong> ${subject}</p></div><div class="text-justify indent-8"><p>Prezados Senhores,</p><p class="mt-4">Pelo presente, encaminhamos a situação do(a) aluno(a) abaixo qualificado(a), solicitando a intervenção deste órgão para garantia dos direitos da criança/adolescente, visto que os recursos escolares foram esgotados.</p></div>${getStudentIdentityCardHTML(student)}<div class="text-justify indent-8 mt-4">${contextParagraph}</div><p class="mt-4 mb-2 font-bold text-gray-700">Histórico de Tentativas de Solução pela Escola:</p>${tableHTML}<p class="text-justify indent-8 mt-6">Diante do exposto e com base no Art. 56 do Estatuto da Criança e do Adolescente (ECA), submetemos o caso para as devidas providências.</p><div class="signature-block mt-24 pt-8 text-center break-inside-avoid"><div class="w-2/3 mx-auto border-t border-black pt-2"><p class="text-sm">Assinatura da Gestão Escolar</p></div></div><div class="mt-8 pt-4 border-t text-xs text-gray-500"><p><strong>Anexos:</strong> ${anexosText}</p></div></div>`;
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
        } catch(e) { console.error(e); }
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
                    ${processes.map(p => { p.actions.sort((a,b) => (a.createdAt?.toDate()||0) - (b.createdAt?.toDate()||0)); const last = p.actions[p.actions.length-1]; const status = p.actions.some(x => x.actionType === 'analise') ? 'Concluído' : 'Em andamento'; return `<tr><td>${p.studentName}</td><td>${p.actions.length}</td><td>${actionDisplayTitles[last.actionType]}</td><td>${status}</td></tr>`; }).join('')}
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
        } catch(e) { console.error(e); }
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

// Expõe globalmente para o index.html acessar se necessário
window.Reports = {
    viewDocument: (doc) => openFichaViewModal(doc.id),
    shareOnWhatsApp: (id) => {
        const content = document.getElementById('report-view-content') || document.getElementById('ficha-view-content') || document.getElementById('notification-content');
        if(!content) return;
        
        // Efeito visual de carregamento
        const oldCursor = document.body.style.cursor;
        document.body.style.cursor = 'wait';
        
        html2canvas(content, {
            scale: 2, // Alta qualidade
            useCORS: true // Para carregar imagens
        }).then(canvas => {
            document.body.style.cursor = oldCursor;
            const link = document.createElement('a');
            link.download = `Documento_Escolar_${id}.png`;
            link.href = canvas.toDataURL();
            link.click();
            
            setTimeout(() => {
                const confirmed = confirm("Imagem salva!\n\nAbrir o WhatsApp agora para enviar?");
                if(confirmed) window.open('https://wa.me/', '_blank');
            }, 500);
        }).catch(err => {
            document.body.style.cursor = oldCursor;
            console.error(err);
            alert('Erro ao gerar imagem.');
        });
    }
};
