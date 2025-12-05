
// =================================================================================
// ARQUIVO: reports.js
// VERSÃO: 9.7 (Com Desafio de Identidade CPF/Nome)
// =================================================================================

import { state, dom } from './state.js';
import { formatDate, formatTime, formatText, showToast, openModal, closeModal, getStatusBadge } from './utils.js';
import { roleIcons, defaultRole, getFilteredOccurrences } from './logic.js';
import { getIncidentByGroupId as fetchIncidentById, getStudentById, getOccurrencesForReport, getAbsencesForReport, saveDocumentSnapshot, findDocumentSnapshot, updateDocumentSignatures } from './firestore.js';


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
    const refId = params.get('refId');
    const type = params.get('type');
    const studentId = params.get('student');

    if (mode === 'sign' && refId && type) {
        console.log("Modo de Assinatura Remota Detectado");
        
        // Substitui o corpo do site pelo modo de assinatura segura
        document.body.innerHTML = `
            <div id="remote-sign-container" class="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4 font-sans">
                <div class="animate-pulse flex flex-col items-center">
                    <div class="h-12 w-12 bg-sky-200 rounded-full mb-4"></div>
                    <p class="text-gray-600 font-bold">Iniciando ambiente seguro...</p>
                </div>
            </div>`;

        try {
            const docSnapshot = await findDocumentSnapshot(type, studentId, refId);
            
            if (!docSnapshot) {
                document.getElementById('remote-sign-container').innerHTML = `<div class="bg-white p-8 rounded-lg shadow-xl mt-10 text-center"><h1 class="text-2xl font-bold text-red-600 mb-2">Link Inválido</h1><p>Documento não encontrado ou expirado.</p></div>`;
                return;
            }

            const container = document.getElementById('remote-sign-container');

            // --- FASE 1: DESAFIO DE IDENTIDADE (NOVO) ---
            // Renderiza tela de bloqueio pedindo Nome e CPF
            const renderIdentityChallenge = () => {
                container.innerHTML = `
                    <div class="w-full max-w-md bg-white shadow-2xl rounded-xl overflow-hidden">
                        <div class="bg-sky-800 p-6 text-white text-center">
                            <i class="fas fa-shield-alt text-4xl mb-2"></i>
                            <h2 class="text-xl font-bold uppercase">Área Restrita</h2>
                            <p class="text-xs opacity-80 mt-1">Identificação Obrigatória</p>
                        </div>
                        <div class="p-6 md:p-8 space-y-4">
                            <p class="text-sm text-gray-600 text-center mb-4">Para visualizar e assinar o documento referente ao aluno(a), por favor confirme sua identidade.</p>
                            
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Seu Nome Completo</label>
                                <input id="input-signer-name" type="text" class="w-full p-3 border border-gray-300 rounded focus:ring-2 focus:ring-sky-500 outline-none uppercase text-sm" placeholder="Digite seu nome">
                            </div>
                            
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Seu CPF</label>
                                <input id="input-signer-cpf" type="tel" class="w-full p-3 border border-gray-300 rounded focus:ring-2 focus:ring-sky-500 outline-none text-sm" placeholder="000.000.000-00" maxlength="14">
                            </div>

                            <button id="btn-access-doc" class="w-full mt-4 bg-sky-600 hover:bg-sky-700 text-white font-bold py-3 px-4 rounded shadow transition transform active:scale-95">
                                ACESSAR DOCUMENTO
                            </button>
                            
                            <p class="text-[10px] text-gray-400 text-center mt-2">
                                <i class="fas fa-lock"></i> Seus dados serão vinculados à assinatura digital deste documento conforme Art. 10 da MP 2.200-2.
                            </p>
                        </div>
                    </div>
                `;

                // Máscara simples de CPF
                const cpfInput = document.getElementById('input-signer-cpf');
                cpfInput.addEventListener('input', (e) => {
                    let v = e.target.value.replace(/\D/g, "");
                    if(v.length > 11) v = v.slice(0, 11);
                    v = v.replace(/(\d{3})(\d)/, "$1.$2");
                    v = v.replace(/(\d{3})(\d)/, "$1.$2");
                    v = v.replace(/(\d{3})(\d{1,2})$/, "$1-$2");
                    e.target.value = v;
                });

                document.getElementById('btn-access-doc').onclick = () => {
                    const name = document.getElementById('input-signer-name').value.trim();
                    const cpf = cpfInput.value.trim();

                    if (name.length < 5) { alert("Por favor, digite seu nome completo."); return; }
                    if (cpf.length < 11) { alert("Por favor, digite um CPF válido."); return; }

                    // Se validou, passa para a Fase 2 com os dados
                    renderDocumentView({ name, cpf });
                };
            };


            // --- FASE 2: VISUALIZAÇÃO E ASSINATURA ---
            const renderDocumentView = (identityData) => {
                // Remove justify-center para permitir scroll em telas pequenas na visualização do doc
                container.classList.remove('justify-center'); 
                container.classList.add('pt-4');

                container.innerHTML = `
                    <div class="w-full max-w-3xl bg-white shadow-2xl rounded-xl overflow-hidden mb-8">
                        <div class="bg-green-700 p-4 text-white flex justify-between items-center">
                            <div>
                                <h2 class="text-sm font-bold uppercase"><i class="fas fa-file-contract"></i> Documento Liberado</h2>
                                <p class="text-[10px] opacity-80">Acesso por: ${identityData.name} (CPF: ${identityData.cpf})</p>
                            </div>
                            <div class="text-right text-[10px]">
                                <span class="bg-green-800 px-2 py-1 rounded">Ambiente Seguro</span>
                            </div>
                        </div>
                        <div class="p-6 md:p-10 text-sm overflow-auto max-h-[60vh] bg-gray-50 border-b">
                            ${docSnapshot.htmlContent}
                        </div>
                        <div class="bg-gray-100 p-6 flex flex-col items-center gap-4">
                            <div class="text-center mb-2">
                                <p class="font-bold text-gray-800 text-lg">Declaração Final de Aceite</p>
                                <p class="text-xs text-gray-600 max-w-md mx-auto text-justify">
                                    Eu, <strong>${identityData.name}</strong>, portador(a) do CPF <strong>${identityData.cpf}</strong>, declaro ter lido e compreendido integralmente o teor deste documento. O clique no botão abaixo equivale à minha assinatura manuscrita para todos os fins legais.
                                </p>
                            </div>
                            <button id="btn-remote-agree" class="bg-green-600 hover:bg-green-700 text-white text-lg font-bold py-4 px-10 rounded-full shadow-lg transform transition hover:scale-105 flex items-center gap-2">
                                <i class="fas fa-check-double"></i> CONFIRMAR E ASSINAR
                            </button>
                            <p class="text-[10px] text-gray-400 mt-2 text-center">
                                Rastreabilidade Digital Ativa: IP e Device ID serão gravados.<br>
                                ${new Date().toLocaleString()}
                            </p>
                        </div>
                    </div>
                `;

                // Lógica do Aceite Final
                document.getElementById('btn-remote-agree').onclick = async function() {
                    const btn = this;
                    btn.disabled = true;
                    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registrando no Blockchain...'; // Efeito psicológico
                    
                    const meta = await fetchClientMetadata();
                    
                    const digitalSignature = {
                        type: 'digital_ack',
                        ip: meta.ip,
                        device: meta.userAgent,
                        timestamp: meta.timestamp,
                        signerName: identityData.name, // Salva o nome digitado
                        signerCPF: identityData.cpf,   // Salva o CPF digitado
                        valid: true
                    };

                    // Identifica a chave (assumindo responsible_{studentId})
                    const key = `responsible_${studentId}`;
                    const sigMap = new Map();
                    sigMap.set(key, digitalSignature);

                    const success = await updateDocumentSignatures(docSnapshot.id, sigMap);

                    if (success) {
                        container.innerHTML = `
                            <div class="h-[80vh] flex items-center justify-center">
                                <div class="bg-white p-10 rounded-2xl shadow-xl text-center max-w-md border-2 border-green-100">
                                    <div class="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                                        <i class="fas fa-check text-5xl text-green-600"></i>
                                    </div>
                                    <h1 class="text-2xl font-bold text-gray-800 mb-2">Assinatura Recebida!</h1>
                                    <p class="text-gray-600 mb-6 text-sm">O documento foi assinado por <strong>${identityData.name}</strong> e arquivado digitalmente na escola.</p>
                                    <div class="bg-gray-100 p-3 rounded text-xs text-left text-gray-500 font-mono">
                                        HASH: ${Math.random().toString(36).substring(2, 15).toUpperCase()}<br>
                                        CPF SHA1: ***${identityData.cpf.slice(-4)}<br>
                                        IP: ${meta.ip}
                                    </div>
                                    <button onclick="window.close()" class="mt-6 text-sky-600 font-bold text-sm hover:underline">Fechar Janela</button>
                                </div>
                            </div>`;
                    } else {
                        alert("Erro de conexão ao salvar. Tente novamente.");
                        btn.disabled = false;
                        btn.innerHTML = 'Tentar Novamente';
                    }
                };
            };

            // Inicia fluxo
            renderIdentityChallenge();

        } catch (e) {
            console.error(e);
            alert("Erro fatal ao carregar sistema de assinatura.");
        }
    }
};

// Inicializa verificação ao carregar arquivo
setTimeout(checkForRemoteSignParams, 500);


// --- MODAL DE ASSINATURA (COM ABAS: DESENHO / LINK) ---

const ensureSignatureModalExists = () => {
    if (document.getElementById('signature-pad-modal')) return;

    const modalHTML = `
    <div id="signature-pad-modal" class="fixed inset-0 bg-gray-900 bg-opacity-75 hidden items-center justify-center z-[60] font-sans">
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 flex flex-col max-h-[95vh] overflow-hidden">
            
            <!-- HEADER COM ABAS -->
            <div class="flex border-b bg-gray-50">
                <button id="tab-draw" class="flex-1 py-3 text-sm font-bold text-sky-700 border-b-2 border-sky-600 bg-white transition">
                    <i class="fas fa-pen-alt mr-1"></i> Desenhar
                </button>
                <button id="tab-link" class="flex-1 py-3 text-sm font-bold text-gray-500 hover:text-sky-600 transition">
                    <i class="fab fa-whatsapp mr-1"></i> Link / Digital
                </button>
            </div>
            
            <div class="p-4 overflow-y-auto">
                
                <!-- CONTEÚDO TAB 1: DESENHO (PADRÃO) -->
                <div id="content-tab-draw">
                    <div class="bg-black rounded-lg overflow-hidden relative mb-4 h-40 flex items-center justify-center group shadow-inner">
                        <video id="camera-preview" autoplay playsinline class="w-full h-full object-cover"></video>
                        <canvas id="photo-canvas" class="hidden"></canvas>
                        <img id="photo-result" class="hidden w-full h-full object-cover absolute top-0 left-0 z-10" />
                        <div class="absolute bottom-2 w-full flex justify-center gap-2 z-20">
                            <button id="btn-take-photo" class="bg-white text-gray-900 rounded-full px-3 py-1 text-xs font-bold shadow hover:bg-gray-200"><i class="fas fa-camera"></i> Foto (Obrigatória)</button>
                            <button id="btn-retake-photo" class="hidden bg-yellow-400 text-yellow-900 rounded-full px-3 py-1 text-xs font-bold shadow"><i class="fas fa-redo"></i> Refazer</button>
                        </div>
                    </div>

                    <div class="flex justify-between items-end mb-1">
                        <p class="text-xs font-bold text-gray-600 uppercase">Assinatura</p>
                        <div class="flex gap-1">
                            <button id="btn-undo-signature" class="bg-gray-200 px-2 py-0.5 rounded text-[10px] font-bold hover:bg-gray-300" title="Desfazer Traço"><i class="fas fa-undo"></i></button>
                            <button id="btn-clear-signature" class="bg-red-100 text-red-700 px-2 py-0.5 rounded text-[10px] font-bold hover:bg-red-200" title="Limpar Tudo"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                    <div class="border-2 border-dashed border-gray-400 rounded bg-gray-50 relative touch-none">
                        <canvas id="signature-canvas" class="w-full h-32 cursor-crosshair"></canvas>
                    </div>
                </div>

                <!-- CONTEÚDO TAB 2: LINK SEGURO -->
                <div id="content-tab-link" class="hidden space-y-4">
                    
                    <!-- OPÇÃO A: ENVIAR VIA WHATSAPP -->
                    <div class="bg-green-50 border border-green-200 rounded-lg p-4">
                        <h4 class="font-bold text-green-800 text-sm mb-1"><i class="fab fa-whatsapp"></i> Link Seguro via WhatsApp</h4>
                        <p class="text-xs text-green-700 mb-3 text-justify leading-tight">
                            Gere um link único. O pai abre no celular, <strong>confirma Nome e CPF</strong> e assina. O sistema registra IP e Modelo do aparelho.
                        </p>
                        <div class="bg-white p-2 rounded border border-gray-200 text-[10px] text-gray-500 mb-3 font-mono break-all" id="generated-link-preview">
                            Selecione um documento primeiro...
                        </div>
                        <button id="btn-send-whatsapp" class="w-full bg-green-600 text-white font-bold py-2 rounded shadow hover:bg-green-700 text-sm flex items-center justify-center gap-2">
                            <i class="fas fa-share"></i> Enviar Link Agora
                        </button>
                        <p class="text-[9px] text-center text-gray-400 mt-2">Nota: O sistema precisa estar online para o pai acessar de casa.</p>
                    </div>

                    <div class="flex items-center justify-center text-gray-400 text-xs font-bold my-2">- OU -</div>

                    <!-- OPÇÃO B: ACEITE PRESENCIAL (TABLET) -->
                    <div class="bg-sky-50 border border-sky-200 rounded-lg p-4 text-center">
                        <h4 class="font-bold text-sky-800 text-sm mb-1">Ciência Digital (Dispositivo Atual)</h4>
                        <p class="text-xs text-sky-700 mb-3 leading-tight">
                            O responsável está aqui mas prefere não desenhar? Use o botão abaixo para registrar o aceite eletrônico neste aparelho.
                        </p>
                        <button id="btn-digital-ack" class="w-full bg-sky-600 text-white font-bold py-3 rounded shadow hover:bg-sky-700 flex items-center justify-center gap-2">
                            <i class="fas fa-fingerprint"></i> REGISTRAR ACEITE
                        </button>
                    </div>

                </div>

            </div>

            <!-- FOOTER -->
            <div class="flex justify-between items-center bg-gray-50 p-3 border-t">
                <button id="btn-cancel-signature" class="px-4 py-2 rounded text-gray-600 hover:bg-gray-200 text-xs font-bold">Cancelar</button>
                <button id="btn-confirm-signature" class="px-6 py-2 rounded bg-gray-900 text-white font-bold hover:bg-gray-800 shadow text-xs">Confirmar Desenho</button>
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
    
    // --- LÓGICA DE ABAS ---
    tabDraw.onclick = () => {
        contentDraw.classList.remove('hidden');
        contentLink.classList.add('hidden');
        tabDraw.className = "flex-1 py-3 text-sm font-bold text-sky-700 border-b-2 border-sky-600 bg-white transition";
        tabLink.className = "flex-1 py-3 text-sm font-bold text-gray-500 hover:text-sky-600 transition";
        btnConfirm.classList.remove('hidden');
        startCamera();
        
        // Resize canvas ao trocar de aba para garantir render correto
        const rect = canvas.parentElement.getBoundingClientRect();
        if(rect.width > 0) { canvas.width = rect.width; canvas.height = 128; redrawCanvas(); }
    };

    tabLink.onclick = () => {
        contentDraw.classList.add('hidden');
        contentLink.classList.remove('hidden');
        tabLink.className = "flex-1 py-3 text-sm font-bold text-sky-700 border-b-2 border-sky-600 bg-white transition";
        tabDraw.className = "flex-1 py-3 text-sm font-bold text-gray-500 hover:text-sky-600 transition";
        btnConfirm.classList.add('hidden'); 
        stopCameraStream();

        // GERA O LINK
        if (currentDocumentIdForRemote) {
            const baseUrl = window.location.href.split('?')[0];
            const fullLink = `${baseUrl}?mode=sign&type=notificacao&refId=${currentDocumentIdForRemote}&student=${currentDocumentKeyForRemote.replace('responsible_', '')}`;
            document.getElementById('generated-link-preview').innerText = fullLink;
            
            document.getElementById('btn-send-whatsapp').onclick = () => {
                const msg = `Olá. Segue link seguro para assinatura da notificação escolar: ${fullLink}`;
                window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
            };
        } else {
            document.getElementById('generated-link-preview').innerText = "Salve o documento antes de gerar o link.";
        }
    };

    // --- BOTÃO ACEITE DIGITAL PRESENCIAL ---
    document.getElementById('btn-digital-ack').onclick = async () => {
        if (!confirm("Confirmar assinatura digital com registro de IP e Dispositivo?")) return;
        
        showToast("Registrando biometria digital...");
        const meta = await fetchClientMetadata();
        
        const digitalData = {
            type: 'digital_ack',
            ip: meta.ip,
            device: meta.userAgent,
            timestamp: meta.timestamp,
            valid: true
        };

        stopCameraStream();
        modal.classList.add('hidden');
        modal.classList.remove('flex');

        if (modal._onConfirmCallback) modal._onConfirmCallback(digitalData);
    };

    // --- CÂMERA ---
    const btnTake = document.getElementById('btn-take-photo');
    const btnRetake = document.getElementById('btn-retake-photo');
    const video = document.getElementById('camera-preview');
    const photoResult = document.getElementById('photo-result');
    const photoCanvas = document.getElementById('photo-canvas');
    let capturedPhotoData = null;

    btnTake.onclick = () => {
        if (!currentStream) return showToast("Câmera desligada.");
        photoCanvas.width = video.videoWidth;
        photoCanvas.height = video.videoHeight;
        photoCanvas.getContext('2d').drawImage(video, 0, 0);
        capturedPhotoData = photoCanvas.toDataURL('image/jpeg', 0.6);
        photoResult.src = capturedPhotoData;
        photoResult.classList.remove('hidden');
        btnTake.classList.add('hidden');
        btnRetake.classList.remove('hidden');
    };

    btnRetake.onclick = () => {
        capturedPhotoData = null;
        photoResult.classList.add('hidden');
        btnTake.classList.remove('hidden');
        btnRetake.classList.add('hidden');
    };

    // --- DESENHO (COM UNDO) ---
    const redrawCanvas = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#000';
        savedPaths.forEach(path => {
            ctx.beginPath();
            if(path.length) {
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
        return { x: (clientX - rect.left)*(canvas.width/rect.width), y: (clientY - rect.top)*(canvas.height/rect.height) };
    };

    canvas.addEventListener('mousedown', (e) => { isDrawing=true; currentPath=[getPos(e)]; });
    canvas.addEventListener('mousemove', (e) => { if(!isDrawing)return; const p=getPos(e); currentPath.push(p); ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
    canvas.addEventListener('mouseup', () => { if(isDrawing){ isDrawing=false; savedPaths.push([...currentPath]); redrawCanvas(); } });
    canvas.addEventListener('touchstart', (e) => { e.preventDefault(); isDrawing=true; currentPath=[getPos(e)]; }, {passive: false});
    canvas.addEventListener('touchmove', (e) => { e.preventDefault(); if(!isDrawing)return; const p=getPos(e); currentPath.push(p); ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(p.x, p.y); }, {passive: false});
    canvas.addEventListener('touchend', (e) => { if(isDrawing){ isDrawing=false; savedPaths.push([...currentPath]); redrawCanvas(); } });

    document.getElementById('btn-undo-signature').onclick = () => { savedPaths.pop(); redrawCanvas(); };
    document.getElementById('btn-clear-signature').onclick = () => { savedPaths=[]; currentPath=[]; ctx.clearRect(0,0,canvas.width,canvas.height); };

    btnConfirm.onclick = () => {
        const signatureData = canvas.toDataURL('image/png');
        const evidenceData = !photoResult.classList.contains('hidden') ? photoResult.src : null;
        stopCameraStream();
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        if (modal._onConfirmCallback) modal._onConfirmCallback({ signature: signatureData, photo: evidenceData });
    };

    document.getElementById('btn-cancel-signature').onclick = () => {
        stopCameraStream();
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    };
};

const startCamera = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        currentStream = stream;
        document.getElementById('camera-preview').srcObject = stream;
    } catch(e) { console.error("Erro Câmera", e); }
};

const stopCameraStream = () => { 
    if(currentStream) currentStream.getTracks().forEach(t=>t.stop()); 
    currentStream=null; 
};

// --- ABRIR MODAL ---
const openSignaturePad = (key, docRefId, onConfirm) => {
    ensureSignatureModalExists();
    const modal = document.getElementById('signature-pad-modal');
    modal._onConfirmCallback = onConfirm;
    
    currentDocumentKeyForRemote = key;
    currentDocumentIdForRemote = docRefId; 
    savedPaths = [];
    currentPath = [];
    
    document.getElementById('tab-draw').click(); // Reseta para aba de desenho
    
    // Limpa canvas visualmente
    const canvas = document.getElementById('signature-canvas');
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
};


// --- HELPERS DE DADOS ---

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

// --- HELPERS DE HTML ---

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

// --- GERAÇÃO VISUAL DA ASSINATURA ---
const getSingleSignatureBoxHTML = (key, roleTitle, nameSubtitle, sigData) => {
    // Caso 1: Assinatura Digital (Botão Verde)
    if (sigData && sigData.type === 'digital_ack') {
        return `
            <div class="relative group p-1 border-2 border-green-500 bg-green-50 rounded break-inside-avoid flex items-center justify-between overflow-hidden" data-sig-key="${key}">
                <div class="p-2 flex-1">
                    <p class="text-[10px] font-bold uppercase text-green-800">${roleTitle}</p>
                    <p class="text-[9px] text-green-700">${nameSubtitle}</p>
                    <div class="mt-1 text-[8px] text-green-600 font-mono leading-tight">
                        ${sigData.signerName ? `<i class="fas fa-user-check"></i> ${sigData.signerName}<br>` : ''}
                        ${sigData.signerCPF ? `<i class="fas fa-id-card"></i> CPF: ${sigData.signerCPF}<br>` : ''}
                        <i class="fas fa-globe"></i> IP: ${sigData.ip || 'N/A'}<br>
                        <i class="fas fa-clock"></i> ${new Date(sigData.timestamp).toLocaleString()}
                    </div>
                </div>
                <div class="bg-green-500 w-10 h-full flex items-center justify-center text-white text-xl">
                    <i class="fas fa-check-circle"></i>
                </div>
            </div>`;
    } 
    // Caso 2: Assinatura Desenhada (Com Foto)
    else if (sigData && (sigData.signature || typeof sigData === 'string')) {
        const img = sigData.signature || sigData;
        const photo = sigData.photo;
        return `
            <div class="relative group cursor-pointer p-1 border border-gray-300 rounded bg-white break-inside-avoid flex items-stretch overflow-hidden" data-sig-key="${key}">
                <div class="w-16 bg-gray-100 border-r border-gray-300 flex flex-col items-center justify-center shrink-0">
                    ${photo ? `<img src="${photo}" class="w-full h-20 object-cover" />` : `<i class="fas fa-user text-gray-300 text-2xl"></i>`}
                </div>
                <div class="flex-1 flex flex-col justify-between p-2 relative">
                    <img src="${img}" class="h-12 object-contain mix-blend-multiply self-center" />
                    <div class="border-t border-black mt-1 w-full"></div>
                    <div class="text-center leading-tight">
                        <p class="text-[10px] font-bold uppercase">${roleTitle}</p>
                        <p class="text-[9px] text-gray-500 truncate">${nameSubtitle}</p>
                    </div>
                </div>
            </div>`;
    } 
    // Caso 3: Vazio
    else {
        return `
            <div class="h-24 border border-dashed border-gray-300 rounded bg-gray-50 flex flex-col items-center justify-center text-gray-400 cursor-pointer hover:bg-gray-100 transition signature-interaction-area" data-sig-key="${key}">
                <i class="fas fa-fingerprint text-2xl mb-1 opacity-50"></i>
                <p class="text-[10px] uppercase font-bold">Aguardando Assinatura</p>
                <p class="text-[9px]">${roleTitle}</p>
                <p class="text-[9px] text-sky-600 font-bold mt-2">Clique para Assinar</p>
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
        <div class="mt-8 mb-8 break-inside-avoid p-4 bg-gray-50 rounded border border-gray-200">
             <h5 class="text-[10px] font-bold uppercase text-gray-500 mb-4 border-b border-gray-300 pb-1 flex justify-between">
                <span>Registro de Validação e Presença</span>
                <span class="text-[9px] font-normal"><i class="fas fa-shield-alt"></i> Proteção Biométrica Ativa</span>
             </h5>
             <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">${itemsHTML}</div>
             <div class="mt-6 pt-4 border-t border-gray-200">
                <p class="text-[10px] text-gray-400 text-center mb-2 uppercase tracking-widest">Autenticação da Gestão</p>
                <div class="w-2/3 mx-auto">
                    ${getSingleSignatureBoxHTML('management', 'Gestão Escolar', state.config?.schoolName || 'Direção', mgmtData)}
                </div>
             </div>
        </div>`;
};

// --- FUNÇÃO CENTRAL DE RENDERIZAÇÃO (IMPORTANTE) ---
async function generateSmartHTML(docType, studentId, refId, htmlGeneratorFn) {
    const existingDoc = await findDocumentSnapshot(docType, studentId, refId);
    
    // Hidrata o mapa com assinaturas existentes
    if (existingDoc && existingDoc.signatures) {
        Object.entries(existingDoc.signatures).forEach(([k, v]) => signatureMap.set(k, v));
    }
    
    const newDate = existingDoc?.createdAt?.toDate() || new Date();
    const html = htmlGeneratorFn(newDate);

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
    
    // Auto-save para gerar ID para o Link
    if (!docId) {
        const docRef = await saveDocumentSnapshot(docType, title, html, studentId, { refId });
        contentDiv.setAttribute('data-doc-ref-id', docRef.id);
    } else {
        await saveDocumentSnapshot(docType, title, html, studentId, { refId });
    }

    attachDynamicSignatureListeners(() => renderDocumentModal(title, contentDivId, docType, studentId, refId, generatorFn));
};

const attachDynamicSignatureListeners = (reRenderCallback) => {
    document.querySelectorAll('.signature-interaction-area').forEach(area => {
        area.onclick = (e) => {
            e.stopPropagation(); 
            const key = area.getAttribute('data-sig-key');
            // Busca o ID do documento renderizado na div pai
            const contentDiv = area.closest('[data-doc-ref-id]');
            const currentDocRefId = contentDiv ? contentDiv.getAttribute('data-doc-ref-id') : 'temp';

            openSignaturePad(key, currentDocRefId, (data) => {
                signatureMap.set(key, data);
                showToast("Assinatura coletada!");
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
        const sigSlots = [{ key: `responsible_${student.matricula}`, role: 'Responsável', name: 'Responsável Legal' }];

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
        const dateString = dateObj.toLocaleDateString('pt-BR', {dateStyle:'long'});
        const sigSlots = [];
        participants.forEach(p => {
            sigSlots.push({ key: `student_${p.student.matricula}`, role: `Aluno (${p.role})`, name: p.student.name });
            sigSlots.push({ key: `responsible_${p.student.matricula}`, role: 'Responsável', name: p.student.name });
        });

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
                    let desc = succ === 'yes' ? `Com: ${rec[`contactPerson_${i}`]}. Prov: ${rec[`providenciasFamilia_${i}`]||''}` : "Responsável não compareceu/atendeu.";
                    if (succ === 'yes' && (rec[`contactPrints_${i}`] || rec[`contactPrint_${i}`])) desc += getPrintHTML(rec[`contactPrints_${i}`], rec[`contactPrint_${i}`]);
                    timelineItems.push({ date: rec[`contactDate_${i}`], title: `Feedback ${i}ª Tentativa`, desc: desc });
                }
                if (i < 3 && rec[`meetingDate_${i+1}`]) timelineItems.push({ date: rec[`meetingDate_${i+1}`], title: `${i+1}ª Convocação`, desc: `Para: ${formatDate(rec[`meetingDate_${i+1}`])}` });
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
        const sigSlots = [{ key: `responsible_${student.matricula}`, role: 'Responsável', name: 'Responsável Legal' }];
        
        return `<div class="space-y-6 text-sm font-serif leading-relaxed text-gray-900">${getReportHeaderHTML(dateObj)}<p class="text-right text-sm italic mb-4">${state.config?.city || "Cidade"}, ${currentDateStr}</p><h3 class="text-xl font-bold text-center uppercase border-b-2 border-gray-300 pb-2 mb-6">${title}</h3>${getStudentIdentityCardHTML(student)}${bodyContent}${generateSignaturesGrid(sigSlots)}</div>`;
    };

    await renderDocumentModal(title, 'ficha-view-content', 'notificacao', student.matricula, record.id, generator);
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
