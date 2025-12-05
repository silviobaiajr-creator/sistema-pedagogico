
// =================================================================================
// ARQUIVO: reports.js
// VERSÃO: 9.4 (Função Desfazer Traço + Acionamento WhatsApp)
// =================================================================================

import { state, dom } from './state.js';
import { formatDate, formatTime, formatText, showToast, openModal, closeModal, getStatusBadge } from './utils.js';
import { roleIcons, defaultRole, getFilteredOccurrences } from './logic.js';
import { getIncidentByGroupId as fetchIncidentById, getStudentById, getOccurrencesForReport, getAbsencesForReport, saveDocumentSnapshot, findDocumentSnapshot } from './firestore.js';


export const actionDisplayTitles = {
    tentativa_1: "1ª Tentativa de Contato",
    tentativa_2: "2ª Tentativa de Contato",
    tentativa_3: "3ª Tentativa de Contato",
    visita: "Visita In Loco",
    encaminhamento_ct: "Encaminhamento ao Conselho Tutelar",
    analise: "Análise"
};

// --- GESTÃO DE ASSINATURA DIGITAL ---
let signatureMap = new Map();
let currentStream = null;

// Variáveis para Controle de Desfazer (Undo)
let savedPaths = []; // Armazena o histórico de traços
let currentPath = []; // Armazena o traço atual sendo desenhado

// Injeta o HTML do Modal de Assinatura
const ensureSignatureModalExists = () => {
    if (document.getElementById('signature-pad-modal')) return;

    const modalHTML = `
    <div id="signature-pad-modal" class="fixed inset-0 bg-gray-900 bg-opacity-75 hidden items-center justify-center z-[60]">
        <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-4 mx-4 flex flex-col max-h-[95vh]">
            <h3 class="text-lg font-bold text-gray-800 mb-2 border-b pb-2 flex justify-between items-center">
                <span>Coleta Biométrica</span>
                <span class="text-xs font-normal text-gray-500 bg-gray-100 px-2 py-1 rounded">Foto + Assinatura</span>
            </h3>
            
            <div class="overflow-y-auto p-1">
                <!-- BOTÃO WHATSAPP (NOVO) -->
                <div class="mb-4 p-3 bg-green-50 border border-green-200 rounded flex justify-between items-center">
                    <div>
                        <p class="text-xs font-bold text-green-800 uppercase">Responsável Ausente?</p>
                        <p class="text-[10px] text-green-600">Envie uma mensagem solicitando comparecimento.</p>
                    </div>
                    <button id="btn-whatsapp-request" class="bg-green-600 text-white px-3 py-1.5 rounded-full text-xs font-bold shadow hover:bg-green-700 flex items-center gap-1">
                        <i class="fab fa-whatsapp"></i> Chamar no Zap
                    </button>
                </div>

                <!-- PASSO 1: FOTO -->
                <p class="text-xs font-bold text-gray-600 mb-1 uppercase">1. Evidência Visual (Foto)</p>
                <div class="bg-black rounded-lg overflow-hidden relative mb-4 h-48 flex items-center justify-center group shadow-inner">
                    <video id="camera-preview" autoplay playsinline class="w-full h-full object-cover"></video>
                    <canvas id="photo-canvas" class="hidden"></canvas>
                    <img id="photo-result" class="hidden w-full h-full object-cover absolute top-0 left-0 z-10" />
                    
                    <div class="absolute bottom-2 w-full flex justify-center gap-2 z-20">
                        <button id="btn-take-photo" class="bg-white text-gray-900 rounded-full px-4 py-1 text-sm font-bold shadow hover:bg-gray-200"><i class="fas fa-camera"></i> Capturar</button>
                        <button id="btn-retake-photo" class="hidden bg-yellow-400 text-yellow-900 rounded-full px-4 py-1 text-sm font-bold shadow hover:bg-yellow-300"><i class="fas fa-redo"></i> Refazer</button>
                    </div>
                    <div id="camera-loading" class="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white text-xs hidden">Iniciando câmera...</div>
                </div>

                <!-- PASSO 2: ASSINATURA -->
                <div class="flex justify-between items-end mb-1">
                    <p class="text-xs font-bold text-gray-600 uppercase">2. Assinatura na Tela</p>
                    <div class="flex gap-1">
                        <button id="btn-undo-signature" class="text-gray-700 bg-gray-200 px-2 py-0.5 rounded text-[10px] font-bold hover:bg-gray-300 flex items-center gap-1" title="Desfazer último traço">
                            <i class="fas fa-undo"></i> Desfazer
                        </button>
                        <button id="btn-clear-signature" class="text-red-700 bg-red-100 px-2 py-0.5 rounded text-[10px] font-bold hover:bg-red-200 flex items-center gap-1" title="Limpar tudo">
                            <i class="fas fa-trash"></i> Limpar
                        </button>
                    </div>
                </div>
                
                <div class="border-2 border-dashed border-gray-400 rounded bg-gray-50 relative touch-none">
                    <canvas id="signature-canvas" class="w-full h-40 cursor-crosshair"></canvas>
                    <div class="absolute bottom-1 right-2 text-[10px] text-gray-400 pointer-events-none select-none">Assine aqui</div>
                </div>
            </div>

            <div class="flex justify-end items-center mt-4 gap-3 pt-2 border-t">
                <button id="btn-cancel-signature" class="px-4 py-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-100 text-sm">Cancelar</button>
                <button id="btn-confirm-signature" class="px-6 py-2 rounded bg-sky-600 text-white font-bold hover:bg-sky-700 shadow text-sm disabled:opacity-50 disabled:cursor-not-allowed">Confirmar & Salvar</button>
            </div>
        </div>
    </div>`;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    setupSignaturePadEvents();
};

const stopCameraStream = () => {
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
        currentStream = null;
    }
};

const startCamera = async () => {
    const video = document.getElementById('camera-preview');
    const loading = document.getElementById('camera-loading');
    
    stopCameraStream(); 

    try {
        loading.classList.remove('hidden');
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, 
            audio: false 
        });
        currentStream = stream;
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            loading.classList.add('hidden');
        };
    } catch (err) {
        console.error("Erro na câmera:", err);
        loading.innerHTML = "Câmera indisponível.<br>Verifique permissões.";
    }
};

// --- LÓGICA DE DESENHO E UNDO ---
const redrawCanvas = (canvas, ctx) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000';

    savedPaths.forEach(path => {
        ctx.beginPath();
        if (path.length > 0) {
            ctx.moveTo(path[0].x, path[0].y);
            for (let i = 1; i < path.length; i++) {
                ctx.lineTo(path[i].x, path[i].y);
            }
            ctx.stroke();
        }
    });
};

const setupSignaturePadEvents = () => {
    const modal = document.getElementById('signature-pad-modal');
    const canvas = document.getElementById('signature-canvas');
    const ctx = canvas.getContext('2d');
    const btnClear = document.getElementById('btn-clear-signature');
    const btnUndo = document.getElementById('btn-undo-signature');
    const btnCancel = document.getElementById('btn-cancel-signature');
    const btnWhatsApp = document.getElementById('btn-whatsapp-request');
    
    // Camera Elements
    const video = document.getElementById('camera-preview');
    const photoCanvas = document.getElementById('photo-canvas');
    const photoResult = document.getElementById('photo-result');
    const btnTake = document.getElementById('btn-take-photo');
    const btnRetake = document.getElementById('btn-retake-photo');

    let capturedPhotoData = null;
    let isDrawing = false;

    // --- CÂMERA ---
    btnTake.onclick = () => {
        if (!currentStream) return showToast("Câmera não iniciada.");
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

    // --- WHATSAPP ---
    btnWhatsApp.onclick = () => {
        // Tenta pegar o nome do documento ou do aluno do contexto
        const docTitle = document.getElementById('report-view-title')?.innerText || "Documento Escolar";
        const msg = `Olá, aqui é da escola. Precisamos da assinatura do responsável no documento: *${docTitle}*. Favor comparecer à secretaria quando possível para regularização.`;
        const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
        window.open(url, '_blank');
    };

    // --- ASSINATURA (COM UNDO E REDRAW) ---
    const resizeCanvas = () => {
        const rect = canvas.parentElement.getBoundingClientRect();
        if (rect.width > 0) {
            canvas.width = rect.width;
            canvas.height = rect.height;
            redrawCanvas(canvas, ctx); // Redesenha ao redimensionar para não perder o traço
        }
    };
    window.addEventListener('resize', resizeCanvas);

    const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: (clientX - rect.left) * (canvas.width / rect.width),
            y: (clientY - rect.top) * (canvas.height / rect.height)
        };
    };

    const startDraw = (e) => {
        if (e.type === 'touchstart') e.preventDefault();
        isDrawing = true;
        currentPath = []; // Inicia novo traço
        const pos = getPos(e);
        currentPath.push(pos);
        
        ctx.beginPath();
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#000';
        ctx.moveTo(pos.x, pos.y);
    };

    const draw = (e) => {
        if (e.type === 'touchmove') e.preventDefault();
        if (!isDrawing) return;
        const pos = getPos(e);
        currentPath.push(pos); // Grava ponto
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
    };

    const stopDraw = () => { 
        if (isDrawing) {
            isDrawing = false;
            if (currentPath.length > 0) {
                savedPaths.push([...currentPath]); // Salva o traço completo no histórico
            }
        }
    };

    // Eventos
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDraw);
    canvas.addEventListener('mouseout', stopDraw);
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDraw);

    // Botão Limpar Tudo
    btnClear.onclick = () => { 
        savedPaths = []; 
        currentPath = [];
        ctx.clearRect(0, 0, canvas.width, canvas.height); 
    };

    // Botão Desfazer (Undo)
    btnUndo.onclick = () => {
        if (savedPaths.length > 0) {
            savedPaths.pop(); // Remove o último traço
            redrawCanvas(canvas, ctx); // Redesenha tudo sem o último traço
        }
    };
    
    btnCancel.onclick = () => { 
        stopCameraStream();
        modal.classList.add('hidden'); 
        modal.classList.remove('flex');
    };
};

const openSignaturePad = (onConfirm) => {
    ensureSignatureModalExists();
    const modal = document.getElementById('signature-pad-modal');
    const canvas = document.getElementById('signature-canvas');
    const ctx = canvas.getContext('2d');
    const btnConfirm = document.getElementById('btn-confirm-signature');
    const photoResult = document.getElementById('photo-result');
    const btnTake = document.getElementById('btn-take-photo');
    const btnRetake = document.getElementById('btn-retake-photo');

    // Reset UI e Variáveis
    savedPaths = []; // Limpa histórico ao abrir
    currentPath = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    photoResult.classList.add('hidden');
    btnTake.classList.remove('hidden');
    btnRetake.classList.add('hidden');

    // Força resize inicial
    const rect = canvas.parentElement.getBoundingClientRect();
    if (rect.width > 0) { canvas.width = rect.width; canvas.height = 160; } // Ajustado para h-40
    
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#000';

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    startCamera(); 

    btnConfirm.onclick = () => {
        const signatureData = canvas.toDataURL('image/png');
        const evidenceData = !photoResult.classList.contains('hidden') ? photoResult.src : null;

        stopCameraStream();
        modal.classList.add('hidden');
        modal.classList.remove('flex');

        if (onConfirm) onConfirm({ signature: signatureData, photo: evidenceData });
    };
};


// --- HELPERS E DATA RESOLUTION ---

const resolveStudentData = async (studentId, recordSource = null) => {
    let memoryStudent = state.students.find(s => s.matricula === studentId);
    
    const recordName = recordSource?.studentName;
    const recordClass = recordSource?.studentClass;

    if (!memoryStudent) {
        try {
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error("Timeout")), 4000)
            );
            memoryStudent = await Promise.race([
                getStudentById(studentId),
                timeoutPromise
            ]);
        } catch (e) {
            console.warn(`Aviso: Timeout ao carregar dados do aluno ${studentId}.`);
        }
    }

    return {
        matricula: studentId,
        name: recordName || memoryStudent?.name || `Aluno (${studentId})`,
        class: recordClass || memoryStudent?.class || 'N/A',
        endereco: memoryStudent?.endereco || '',
        contato: memoryStudent?.contato || '',
        resp1: memoryStudent?.resp1 || '',
        resp2: memoryStudent?.resp2 || ''
    };
};

const normalizeHTML = (str) => {
    if (!str) return "";
    return str.replace(/\s+/g, '').replace(/&nbsp;/g, '').toLowerCase();
};

async function generateSmartHTML(docType, studentId, refId, htmlGeneratorFn) {
    const existingDoc = await findDocumentSnapshot(docType, studentId, refId);
    
    if (existingDoc && existingDoc.createdAt) {
        const oldDate = existingDoc.createdAt.toDate();
        const oldHTML = htmlGeneratorFn(oldDate); 
        
        if (normalizeHTML(oldHTML) === normalizeHTML(existingDoc.htmlContent)) {
            console.log("Smart Date: Conteúdo inalterado. Mantendo original.");
            return existingDoc.htmlContent; 
        }
    }
    
    const newDate = new Date();
    return htmlGeneratorFn(newDate);
}


// =================================================================================
// HELPERS DE LAYOUT E ASSINATURA DINÂMICA
// =================================================================================

export const getReportHeaderHTML = (dateObj = new Date()) => {
    const logoUrl = state.config?.schoolLogoUrl || null;
    const schoolName = state.config?.schoolName || "Nome da Escola";
    const city = state.config?.city || "Cidade";
    const year = dateObj.getFullYear();

    let headerContent = '';
    
    if (logoUrl) {
        headerContent = `
            <div class="flex items-center gap-4 border-b-2 border-gray-800 pb-4 mb-2">
                <img src="${logoUrl}" alt="Logo" class="w-20 h-20 object-contain" onerror="this.style.display='none'">
                <div class="flex-1 text-center sm:text-left">
                    <h2 class="text-xl font-bold uppercase tracking-wide text-gray-900">${schoolName}</h2>
                    <p class="text-sm text-gray-600 font-semibold uppercase mt-1">${city}</p>
                    <p class="text-xs text-gray-500 mt-1">Sistema de Acompanhamento Pedagógico</p>
                </div>
                <div class="hidden sm:block text-right text-xs text-gray-400">
                    <p>Documento Oficial</p>
                    <p>${year}</p>
                </div>
            </div>`;
    } else {
        headerContent = `
            <div class="text-center border-b-2 border-gray-800 pb-4 mb-2">
                <h2 class="text-2xl font-bold uppercase tracking-wide text-gray-900">${schoolName}</h2>
                <p class="text-sm text-gray-600 font-semibold uppercase mt-1">${city}</p>
            </div>`;
    }

    return headerContent;
};

const getStudentIdentityCardHTML = (student) => {
    const responsaveis = [student.resp1, student.resp2].filter(Boolean).join(' e ') || 'Não informados';
    return `
        <div class="student-id-card break-inside-avoid mb-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm border p-2 rounded bg-gray-50">
                <div class="col-span-2 border-b mb-1 pb-1 font-bold text-gray-500 text-xs uppercase">Dados do Aluno</div>
                <div><strong>Nome:</strong> <span class="uppercase">${formatText(student.name)}</span></div>
                <div><strong>Turma:</strong> ${formatText(student.class)}</div>
                <div class="sm:col-span-2"><strong>Responsáveis:</strong> ${formatText(responsaveis)}</div>
            </div>
        </div>
    `;
};

// --- NOVA LÓGICA DE ASSINATURA COM FOTO EVIDÊNCIA ---

const getSingleSignatureBoxHTML = (key, roleTitle, nameSubtitle, sigData) => {
    // sigData agora pode ser string (legado) ou objeto { signature, photo }
    let signatureImg = null;
    let photoImg = null;

    if (typeof sigData === 'string') {
        signatureImg = sigData;
    } else if (typeof sigData === 'object' && sigData !== null) {
        signatureImg = sigData.signature;
        photoImg = sigData.photo;
    }

    const date = new Date();
    const dateStr = date.toLocaleString('pt-BR');
    const deviceType = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? 'Mobile' : 'Desktop';
    
    // Se tiver foto, mostramos um layout "Cartão de Identidade"
    if (signatureImg) {
        return `
            <div class="relative group cursor-pointer p-1 border border-gray-300 rounded bg-white break-inside-avoid signature-interaction-area flex items-stretch overflow-hidden" data-sig-key="${key}">
                
                <!-- ÁREA DA FOTO (EVIDÊNCIA) -->
                <div class="w-16 bg-gray-100 border-r border-gray-300 flex flex-col items-center justify-center shrink-0">
                    ${photoImg 
                        ? `<img src="${photoImg}" class="w-full h-20 object-cover" alt="Foto Evidência" /><div class="text-[6px] bg-green-100 text-green-800 w-full text-center font-bold">VERIFICADO</div>` 
                        : `<div class="text-gray-300 text-2xl"><i class="fas fa-user-slash"></i></div><div class="text-[6px] text-gray-400 text-center">SEM FOTO</div>`
                    }
                </div>

                <!-- ÁREA DA ASSINATURA -->
                <div class="flex-1 flex flex-col justify-between p-2 relative">
                    <img src="${signatureImg}" class="h-12 object-contain mix-blend-multiply self-center" alt="Assinatura" />
                    
                    <div class="border-t border-black mt-1 w-full"></div>
                    <div class="text-center leading-tight">
                        <p class="text-[10px] font-bold uppercase">${roleTitle}</p>
                        <p class="text-[9px] text-gray-500 truncate max-w-[120px] mx-auto">${nameSubtitle}</p>
                    </div>

                    <div class="absolute top-1 right-1 text-[6px] text-gray-400 font-mono text-right leading-none">
                        ${dateStr}<br>${deviceType}
                    </div>
                </div>
            </div>
        `;
    }

    // Estado Vazio (Aguardando)
    return `
        <div class="h-24 border border-dashed border-gray-300 rounded bg-gray-50 flex flex-col items-center justify-center text-gray-400 cursor-pointer hover:bg-gray-100 transition signature-interaction-area" data-sig-key="${key}">
            <i class="fas fa-fingerprint text-2xl mb-1 opacity-50"></i>
            <p class="text-[10px] uppercase font-bold">Aguardando Assinatura</p>
            <p class="text-[9px]">${roleTitle}</p>
            <p class="text-[9px] text-sky-600 font-bold mt-2"><i class="fas fa-camera"></i> + <i class="fas fa-pen"></i> Assinar</p>
        </div>
    `;
};

const generateSignaturesGrid = (slots) => {
    let itemsHTML = slots.map(slot => {
        const sigData = signatureMap.get(slot.key);
        return getSingleSignatureBoxHTML(slot.key, slot.role, slot.name, sigData);
    }).join('');

    const mgmtData = signatureMap.get('management');
    const mgmtHTML = `
        <div class="mt-6 pt-4 border-t border-gray-200">
            <p class="text-[10px] text-gray-400 text-center mb-2 uppercase tracking-widest">Autenticação da Gestão</p>
            <div class="w-2/3 mx-auto">
                ${getSingleSignatureBoxHTML('management', 'Gestão Escolar', state.config?.schoolName || 'Direção', mgmtData)}
            </div>
        </div>
    `;

    return `
        <div class="mt-8 mb-8 break-inside-avoid p-4 bg-gray-50 rounded border border-gray-200">
             <h5 class="text-[10px] font-bold uppercase text-gray-500 mb-4 border-b border-gray-300 pb-1 flex justify-between">
                <span>Registro de Validação e Presença</span>
                <span class="text-[9px] font-normal"><i class="fas fa-shield-alt"></i> Proteção Biométrica Ativa</span>
             </h5>
             <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                ${itemsHTML}
             </div>
             ${mgmtHTML}
        </div>
    `;
};


// --- HELPERS GERAIS DE CONTEÚDO ---

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


// =================================================================================
// LOGICA DE RE-RENDER E BOTÃO DE ASSINATURA
// =================================================================================

const attachDynamicSignatureListeners = (reRenderCallback) => {
    const interactionAreas = document.querySelectorAll('.signature-interaction-area');
    interactionAreas.forEach(area => {
        area.onclick = (e) => {
            e.stopPropagation(); 
            const key = area.getAttribute('data-sig-key');
            openSignaturePad((data) => {
                // data agora é { signature, photo }
                signatureMap.set(key, data);
                showToast("Assinatura e Foto coletadas!");
                reRenderCallback();
            });
        };
    });

    const container = document.getElementById('report-view-content') || document.getElementById('notification-content') || document.getElementById('ficha-view-content');
    if (container && !document.getElementById('floating-sign-btn')) {
        const btn = document.createElement('button');
        btn.id = 'floating-sign-btn';
        btn.innerHTML = '<i class="fas fa-pen-nib"></i> Assinar';
        btn.className = 'fixed bottom-4 right-4 bg-sky-600 text-white px-4 py-3 rounded-full shadow-lg font-bold text-sm hover:bg-sky-700 z-50 flex items-center gap-2 no-print';
        btn.onclick = () => {
             openSignaturePad((data) => {
                let targetKey = 'management';
                signatureMap.set(targetKey, data); 
                showToast("Assinatura da Gestão coletada!");
                reRenderCallback();
            });
        };
        container.parentElement.appendChild(btn);
    }
};


// =================================================================================
// FUNÇÕES PRINCIPAIS DE GERAÇÃO
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
    const data = incident.records.find(r => r.studentId === studentObj.matricula);
    if (!data) return showAlert(`Erro: Registro não encontrado.`);

    if (!state.students.find(s => s.matricula === studentObj.matricula)) showToast('Carregando dados...');
    const student = await resolveStudentData(studentObj.matricula, data.studentName ? data : studentObj);
    
    let attemptCount = 1;
    if (specificAttempt) attemptCount = parseInt(specificAttempt);
    else {
        if (data.contactSucceeded_1 != null) attemptCount = 2;
        if (data.contactSucceeded_2 != null) attemptCount = 3;
    }

    let meetingDate = data[`meetingDate_${attemptCount}`] || (attemptCount === 1 ? data.meetingDate : null);
    let meetingTime = data[`meetingTime_${attemptCount}`] || (attemptCount === 1 ? data.meetingTime : null);
    
    const uniqueRefId = `${incident.id}_attempt_${attemptCount}`;
    
    signatureMap.clear();
    const sigSlots = [
        { key: `responsible_${student.matricula}`, role: 'Responsável', name: 'Responsável Legal' }
    ];

    const render = async () => {
        const generateContent = (dateObj) => {
            const currentDateStr = dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
            const attemptText = `Esta é a <strong>${attemptCount}ª tentativa</strong> de contato formal realizada pela escola.`;
            
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

        const html = await generateSmartHTML('notificacao', student.matricula, uniqueRefId, generateContent);
        document.getElementById('notification-title').innerText = 'Notificação';
        document.getElementById('notification-content').innerHTML = html;
        attachDynamicSignatureListeners(render);
        saveDocumentSnapshot('notificacao', `Notificação ${attemptCount}ª Tentativa - ${student.name}`, html, student.matricula, { studentName: student.name, refId: uniqueRefId });
    };

    await render();
    openModal(dom.notificationModalBackdrop);
};

export const openOccurrenceRecordModal = async (groupId) => {
    const incident = await fetchIncidentById(groupId);
    if (!incident || incident.records.length === 0) return showToast('Incidente não encontrado.');

    const mainRecord = incident.records[0]; 
    const city = state.config?.city || "Cidade";
    
    signatureMap.clear();
    const participants = [...incident.participantsInvolved.values()];
    const sigSlots = [];

    participants.forEach(p => {
        sigSlots.push({ key: `student_${p.student.matricula}`, role: `Aluno (${p.role})`, name: p.student.name });
        sigSlots.push({ key: `responsible_${p.student.matricula}`, role: 'Responsável por', name: p.student.name });
    });

    const render = async () => {
        const generateContent = (dateObj) => {
            const dateString = dateObj.toLocaleDateString('pt-BR', {dateStyle:'long'});
            
            let html = `
                <div class="space-y-4 text-sm font-serif leading-relaxed text-gray-900">
                    ${getReportHeaderHTML(dateObj)}
                    <h3 class="text-lg font-bold text-center uppercase mb-6 bg-gray-100 py-2 border rounded">ATA DE REGISTRO DE OCORRÊNCIA Nº ${incident.id}</h3>
                    
                    <p class="text-justify indent-8">
                        Aos ${dateString}, foi lavrada a presente ata para registrar os fatos referentes ao incidente classificado como <strong>"${formatText(mainRecord.occurrenceType)}"</strong>.
                    </p>

                    <h4 class="font-bold border-b border-gray-300 mt-6 mb-2 uppercase text-xs text-gray-500">1. Descrição do Fato e Envolvidos</h4>
                    <div class="bg-gray-50 p-4 rounded border border-gray-200 text-sm font-sans mb-4">
                        <p class="italic text-gray-700">"${formatText(mainRecord.description)}"</p>
                    </div>
                    
                    <div class="mb-4">
                        <p class="font-bold text-xs uppercase text-gray-500 mb-2">Alunos Envolvidos:</p>
                        <div class="grid grid-cols-1 gap-2">
                            ${participants.map(p => `
                                <div class="flex items-center gap-2 p-2 border rounded bg-white">
                                    <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${p.role === 'Vítima' ? 'bg-blue-50 text-blue-700 border-blue-200' : p.role === 'Agente' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-gray-50 text-gray-700 border-gray-200'}">${p.role}</span>
                                    <span class="font-semibold text-gray-800">${p.student.name}</span>
                                    <span class="text-xs text-gray-500">(${p.student.class})</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <h4 class="font-bold border-b border-gray-300 mt-6 mb-2 uppercase text-xs text-gray-500">2. Providências Imediatas (Escola)</h4>
                    <p class="text-justify bg-gray-50 p-3 rounded border border-gray-200 font-sans text-sm">${formatText(mainRecord.providenciasEscola)}</p>

                    <h4 class="font-bold border-b border-gray-300 mt-6 mb-2 uppercase text-xs text-gray-500">3. Histórico de Acompanhamento</h4>
            `;

            incident.records.forEach(rec => {
                const participant = incident.participantsInvolved.get(rec.studentId);
                const name = participant ? participant.student.name : rec.studentName;
                let timelineItems = [];

                if (rec.meetingDate) timelineItems.push({ date: rec.meetingDate, title: "1ª Convocação Agendada", desc: `Para: ${formatDate(rec.meetingDate)} às ${formatTime(rec.meetingTime)}` });
                
                for (let i = 1; i <= 3; i++) {
                    const succ = rec[`contactSucceeded_${i}`];
                    if (succ) {
                        const date = rec[`contactDate_${i}`];
                        const status = succ === 'yes' ? "Contato Realizado" : "Sem Sucesso";
                        const prov = rec[`providenciasFamilia_${i}`] || '';
                        const prints = rec[`contactPrints_${i}`];
                        const singlePrint = rec[`contactPrint_${i}`];
                        
                        let desc = succ === 'yes' ? `Com: ${rec[`contactPerson_${i}`]}. Prov: ${prov}` : "Responsável não compareceu/atendeu.";
                        if (succ === 'yes' && ((prints && prints.length) || singlePrint)) desc += getPrintHTML(prints, singlePrint);
                        timelineItems.push({ date: date, title: `Feedback ${i}ª Tentativa`, desc: desc, status: status });
                    }
                    if (i < 3) {
                        const nDate = rec[`meetingDate_${i+1}`];
                        if (nDate) timelineItems.push({ date: nDate, title: `${i+1}ª Convocação Agendada`, desc: `Para: ${formatDate(nDate)} às ${formatTime(rec[`meetingTime_${i+1}`])}` });
                    }
                }

                if (rec.oficioNumber) timelineItems.push({ date: rec.ctSentDate, title: "Encaminhamento CT", desc: `Ofício ${rec.oficioNumber}/${rec.oficioYear}` });
                if (rec.ctFeedback) timelineItems.push({ date: null, title: "Devolutiva CT", desc: rec.ctFeedback });
                if (rec.parecerFinal) timelineItems.push({ date: null, title: "Parecer Final", desc: rec.parecerFinal });

                if (timelineItems.length === 0) {
                    html += `<div class="mb-4"><p class="font-bold text-sm text-gray-800">${name}:</p><p class="text-xs text-gray-500 italic ml-4">Sem ações registradas.</p></div>`;
                } else {
                    html += `<div class="mb-4 break-inside-avoid"><p class="font-bold text-sm text-gray-800 mb-2 bg-sky-50 p-1 px-2 rounded inline-block">${name} <span class="text-xs font-normal text-gray-500">(${rec.statusIndividual})</span></p>`;
                    timelineItems.forEach(item => {
                        html += `<div class="report-timeline-item ml-2"><div class="report-timeline-dot"></div><p class="text-xs font-bold text-gray-700">${item.title} <span class="font-normal text-gray-500 ml-1">${item.date ? `(${formatDate(item.date)})` : ''}</span></p><div class="text-xs text-gray-600 mt-1">${item.desc}</div></div>`;
                    });
                    html += `</div>`;
                }
            });

            html += `
                    <div class="mt-8 pt-4 border-t-2 border-gray-800">
                        <p class="font-bold text-center mb-4">ENCERRAMENTO</p>
                        <p class="text-center text-sm">${incident.overallStatus === 'Finalizada' ? 'Ocorrência finalizada.' : 'Ocorrência segue em acompanhamento.'}</p>
                        <p class="text-center text-sm mt-2">${city}, ${dateString}.</p>
                    </div>
                    ${generateSignaturesGrid(sigSlots)}
                </div>`;
            return html;
        };

        const finalHtml = await generateSmartHTML('ata', null, incident.id, generateContent);
        document.getElementById('report-view-title').textContent = `Ata Nº ${incident.id}`;
        document.getElementById('report-view-content').innerHTML = finalHtml;
        attachDynamicSignatureListeners(render);
        saveDocumentSnapshot('ata', `Ata de Ocorrência Nº ${incident.id}`, finalHtml, null, { refId: incident.id });
    };

    await render();
    openModal(dom.reportViewModalBackdrop);
};

export const openFichaViewModal = async (id) => {
    const record = state.absences.find(abs => abs.id === id);
    if (!record) return showToast('Registro não encontrado.');
    
    if (!state.students.find(s => s.matricula === record.studentId)) showToast('Carregando dados...');
    const student = await resolveStudentData(record.studentId, record);

    let absenceCount = record.absenceCount;
    let periodoStart = record.periodoFaltasStart;
    let periodoEnd = record.periodoFaltasEnd;
    if (!absenceCount) {
        const processActions = state.absences.filter(a => a.processId === record.processId);
        const source = processActions.find(a => a.periodoFaltasStart);
        if (source) { absenceCount = source.absenceCount; periodoStart = source.periodoFaltasStart; periodoEnd = source.periodoFaltasEnd; }
    }

    const titleMap = {
        tentativa_1: "1ª Notificação de Baixa Frequência",
        tentativa_2: "2ª Notificação de Baixa Frequência",
        tentativa_3: "3ª Notificação - Pré-Encaminhamento",
        visita: "Registro de Visita Domiciliar"
    };
    const title = titleMap[record.actionType] || actionDisplayTitles[record.actionType] || "Documento Busca Ativa";
    
    signatureMap.clear();
    const sigSlots = [
         { key: `responsible_${student.matricula}`, role: 'Responsável', name: 'Responsável Legal' }
    ];

    const render = async () => {
        const generateContent = (dateObj) => {
            const currentDateStr = dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
            let bodyContent = '';

            if (record.actionType.startsWith('tentativa')) {
                bodyContent = `
                    <p class="text-justify indent-8">Prezados Responsáveis,</p>
                    <p class="text-justify indent-8 mt-2">Comunicamos que o(a) aluno(a) acima identificado(a) atingiu o número de <strong>${formatText(absenceCount)} faltas</strong> no período de ${formatDate(periodoStart)} a ${formatDate(periodoEnd)}, configurando situação de risco escolar.</p>
                    <div class="my-4 p-3 bg-yellow-50 border-l-4 border-yellow-500 text-sm font-sans rounded"><p><strong>Fundamentação Legal:</strong> Conforme a LDB (Lei 9.394/96) e o ECA, é dever da família assegurar a frequência escolar. A persistência das faltas sem justificativa legal exigirá a notificação obrigatória ao Conselho Tutelar e Ministério Público.</p></div>
                    ${record.meetingDate ? `<p class="text-justify mt-4">Solicitamos comparecimento obrigatório na escola:</p><div class="my-4 mx-auto max-w-xs border border-gray-400 rounded p-3 text-center bg-white shadow-sm"><p class="font-bold text-lg">${formatDate(record.meetingDate)}</p><p class="font-semibold text-gray-700">${formatTime(record.meetingTime)}</p></div>` : `<p class="mt-4 font-bold text-center">Favor comparecer à secretaria da escola com urgência.</p>`}
                `;
            } else if (record.actionType === 'visita') {
                bodyContent = `
                    <p class="text-justify indent-8">Certifico que, nesta data, foi realizada Visita Domiciliar referente ao aluno(a) supracitado(a).</p>
                    <div class="mt-4 p-4 border rounded bg-gray-50 font-sans text-sm"><p><strong>Data da Visita:</strong> ${formatDate(record.visitDate)}</p><p><strong>Agente:</strong> ${formatText(record.visitAgent)}</p><p><strong>Resultado:</strong> ${record.visitSucceeded === 'yes' ? 'Contato Realizado' : 'Sem sucesso'}</p><p class="mt-2"><strong>Observações/Justificativa:</strong></p><p class="italic bg-white p-2 border rounded mt-1">${formatText(record.visitReason)} ${formatText(record.visitObs)}</p></div>
                `;
            }

            return `
                <div class="space-y-6 text-sm font-serif leading-relaxed text-gray-900">
                    ${getReportHeaderHTML(dateObj)}
                    <p class="text-right text-sm italic mb-4">${state.config?.city || "Cidade"}, ${currentDateStr}</p>
                    <h3 class="text-xl font-bold text-center uppercase border-b-2 border-gray-300 pb-2 mb-6">${title}</h3>
                    ${getStudentIdentityCardHTML(student)}
                    ${bodyContent}
                    ${generateSignaturesGrid(sigSlots)}
                </div>`;
        };

        const html = await generateSmartHTML('notificacao', student.matricula, record.id, generateContent);
        document.getElementById('ficha-view-title').textContent = title;
        document.getElementById('ficha-view-content').innerHTML = html;
        attachDynamicSignatureListeners(render);
        saveDocumentSnapshot('notificacao', `${title} - ${student.name}`, html, student.matricula, { studentName: student.name, refId: record.id });
    };

    await render();
    openModal(dom.fichaViewModalBackdrop);
};

export const generateAndShowConsolidatedFicha = async (studentId, processId = null) => {
    let actions = state.absences.filter(a => a.studentId === studentId);
    if (processId) actions = actions.filter(a => a.processId === processId);
    actions.sort((a, b) => (a.createdAt?.toDate() || 0) - (b.createdAt?.toDate() || 0));

    if (actions.length === 0) return showToast('Nenhuma ação encontrada.');
    if (!state.students.find(s => s.matricula === studentId)) showToast('Carregando...');
    const student = await resolveStudentData(studentId, actions[0]);

    const faltasData = actions.find(a => a.periodoFaltasStart) || {};
    const analise = actions.find(a => a.actionType === 'analise');
    const isClosed = !!analise;
    
    const statusStamp = isClosed 
        ? `<div class="absolute top-0 right-0 border-2 border-green-600 text-green-600 font-bold px-2 py-1 transform rotate-12 text-xs uppercase rounded">CONCLUÍDO</div>`
        : `<div class="absolute top-0 right-0 border-2 border-yellow-600 text-yellow-600 font-bold px-2 py-1 transform rotate-12 text-xs uppercase rounded">EM ACOMPANHAMENTO</div>`;

    let timelineHTML = '';
    const formatReturnStatus = (val) => {
        if (val === 'yes') return `<span class="text-green-700 font-bold uppercase">Sim</span>`;
        if (val === 'no') return `<span class="text-red-700 font-bold uppercase">Não</span>`;
        return `<span class="text-gray-400">Pendente</span>`;
    };

    actions.forEach(act => {
        if (act.meetingDate) {
            timelineHTML += `<div class="report-timeline-item ml-2 break-inside-avoid"><div class="report-timeline-dot"></div><p class="text-sm font-bold text-gray-800">Convocação Agendada <span class="font-normal text-xs text-gray-500">(${actionDisplayTitles[act.actionType]})</span></p><p class="text-xs text-gray-600 mt-1">Para: <strong>${formatDate(act.meetingDate)}</strong> às <strong>${formatTime(act.meetingTime)}</strong>.</p></div>`;
        }
        let title = "", desc = "", dateRef = act.createdAt?.toDate(), imgs = "";
        if (act.actionType.startsWith('tentativa')) {
            if (act.contactSucceeded) {
                title = `Registro de Contato (${formatText(actionDisplayTitles[act.actionType])})`;
                dateRef = act.contactDate;
                const status = act.contactSucceeded === 'yes' ? "Contato Realizado" : "Sem Sucesso/Não Compareceu";
                desc = `<strong>Status:</strong> ${status}.<br>`;
                if(act.contactSucceeded === 'yes') {
                    desc += `<strong>Com quem falou:</strong> ${formatText(act.contactPerson)}.<br><strong>Justificativa/Combinado:</strong> ${formatText(act.contactReason)}.`;
                    imgs = getPrintHTML(act.contactPrints, act.contactPrint);
                }
                desc += `<br><span class="bg-gray-100 px-1 rounded border border-gray-300 mt-1 inline-block"><strong>Retorno à Escola:</strong> ${formatReturnStatus(act.contactReturned)}</span>`;
            }
        } else if (act.actionType === 'visita') {
            title = "Visita Domiciliar Realizada";
            dateRef = act.visitDate;
            desc = `<strong>Agente:</strong> ${formatText(act.visitAgent)}.<br><strong>Status:</strong> ${act.visitSucceeded === 'yes' ? "Contato Realizado" : "Sem contato/Não atendido"}.<br><strong>Obs:</strong> ${formatText(act.visitReason)} ${formatText(act.visitObs)}.<br><span class="bg-gray-100 px-1 rounded border border-gray-300 mt-1 inline-block"><strong>Retorno à Escola:</strong> ${formatReturnStatus(act.visitReturned)}</span>`;
        } else if (act.actionType === 'encaminhamento_ct') {
            title = "Encaminhamento ao Conselho Tutelar";
            dateRef = act.ctSentDate;
            desc = `<strong>Ofício Nº:</strong> ${formatText(act.oficioNumber)}/${formatText(act.oficioYear)}.<br>`;
            if (act.ctFeedback) desc += `<div class="mt-2 pt-2 border-t border-gray-200"><strong>Devolutiva CT:</strong> ${formatText(act.ctFeedback)}</div>`;
            if (act.ctReturned) desc += `<br><span class="bg-gray-100 px-1 rounded border border-gray-300 mt-1 inline-block"><strong>Retorno à Escola:</strong> ${formatReturnStatus(act.ctReturned)}</span>`;
        } else if (act.actionType === 'analise') {
            title = "Parecer Final / Conclusão";
            desc = formatText(act.ctParecer);
        }

        if (title) timelineHTML += `<div class="report-timeline-item ml-2 break-inside-avoid"><div class="report-timeline-dot" style="background-color: #4b5563;"></div><p class="text-sm font-bold text-gray-800">${title} <span class="font-normal text-xs text-gray-500">(${formatDate(dateRef)})</span></p><div class="text-xs text-gray-600 mt-1 leading-relaxed">${desc}</div>${imgs}</div>`;
    });

    if (!timelineHTML) timelineHTML = '<p class="text-sm text-gray-500 italic pl-4">Nenhuma ação detalhada registrada.</p>';

    // Na ficha consolidada, geralmente assina só a escola, mas pode ser expandido
    const html = `
        <div class="space-y-6 text-sm font-sans relative">
            ${getReportHeaderHTML()}
            ${statusStamp}
            <h3 class="text-xl font-bold text-center uppercase border-b pb-2">Ficha Individual de Busca Ativa</h3>
            ${getStudentIdentityCardHTML(student)}
            <div class="bg-gray-50 p-4 rounded border border-gray-200 grid grid-cols-3 gap-4 text-center"><div><p class="text-xs font-bold text-gray-500 uppercase">Total Faltas</p><p class="text-xl font-bold text-red-600">${formatText(faltasData.absenceCount)}</p></div><div><p class="text-xs font-bold text-gray-500 uppercase">Início Período</p><p class="font-semibold">${formatDate(faltasData.periodoFaltasStart)}</p></div><div><p class="text-xs font-bold text-gray-500 uppercase">Fim Período</p><p class="font-semibold">${formatDate(faltasData.periodoFaltasEnd)}</p></div></div>
            <h4 class="font-bold border-b mt-6 mb-4 uppercase text-xs text-gray-500">Histórico de Acompanhamento (Cronologia)</h4>
            <div class="pl-2 border-l-2 border-gray-100">${timelineHTML}</div>
            <div class="signature-block mt-24 pt-8 grid grid-cols-2 gap-8 break-inside-avoid"><div class="text-center"><div class="border-t border-black mb-1"></div><p class="text-xs">Direção</p></div><div class="text-center"><div class="border-t border-black mb-1"></div><p class="text-xs">Coordenação</p></div></div>
        </div>`;

    document.getElementById('report-view-title').textContent = "Ficha Consolidada";
    document.getElementById('report-view-content').innerHTML = html;
    openModal(dom.reportViewModalBackdrop);
    saveDocumentSnapshot('ficha_busca_ativa', `Ficha Individual - ${student.name}`, html, student.matricula, { studentName: student.name, refId: processId });
};

// FUNÇÃO MESTRE DE OFÍCIO
const generateAndShowGenericOficio = async (data, oficioNum, type, studentObjOverride = null) => {
    if (!data) return showToast('Dados inválidos.');
    
    const studentId = data.studentId;
    if (!state.students.find(s => s.matricula === studentId)) showToast('Carregando dados...');
    const student = await resolveStudentData(studentId, studentObjOverride || data);

    const oficioYear = data.oficioYear || new Date().getFullYear();
    const city = state.config?.city || "Cidade";
    
    // Configura Assinaturas (Padrão: Apenas Gestão, pois vai pro Conselho)
    signatureMap.clear();
    const sigSlots = []; // Vazio = gera só o da gestão

    const render = async () => {
        const generateContent = (dateObj) => {
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

            return `
                <div class="space-y-6 text-sm font-serif leading-relaxed text-gray-900">
                    <div>${getReportHeaderHTML(dateObj)}<p class="text-right mt-4">${city}, ${currentDateStr}.</p></div>
                    <div class="mt-8 font-bold text-lg">OFÍCIO Nº ${String(oficioNum).padStart(3, '0')}/${oficioYear}</div>
                    <div class="mt-4"><p><strong>Ao Ilustríssimo(a) Senhor(a) Conselheiro(a) Tutelar</strong></p><p>Conselho Tutelar de ${city}</p></div>
                    <div class="bg-gray-100 p-2 border rounded mt-4 mb-6"><p><strong>Assunto:</strong> ${subject}</p></div>
                    <div class="text-justify indent-8"><p>Prezados Senhores,</p><p class="mt-4">Pelo presente, encaminhamos a situação do(a) aluno(a) abaixo qualificado(a), solicitando a intervenção deste órgão para garantia dos direitos da criança/adolescente, visto que os recursos escolares foram esgotados.</p></div>
                    ${getStudentIdentityCardHTML(student)}
                    <div class="text-justify indent-8 mt-4">${contextParagraph}</div>
                    <p class="mt-4 mb-2 font-bold text-gray-700">Histórico de Tentativas de Solução pela Escola:</p>
                    ${tableHTML}
                    <p class="text-justify indent-8 mt-6">Diante do exposto e com base no Art. 56 do Estatuto da Criança e do Adolescente (ECA), submetemos o caso para as devidas providências.</p>
                    ${generateSignaturesGrid(sigSlots)}
                    <div class="mt-8 pt-4 border-t text-xs text-gray-500"><p><strong>Anexos:</strong> ${anexosText}</p></div>
                </div>`;
        };

        const html = await generateSmartHTML('oficio', student.matricula, data.id, generateContent);
        document.getElementById('report-view-title').textContent = `Ofício Nº ${oficioNum}/${oficioYear}`;
        document.getElementById('report-view-content').innerHTML = html;
        attachDynamicSignatureListeners(render);
        saveDocumentSnapshot('oficio', `Ofício Nº ${oficioNum}/${oficioYear} - ${student.name}`, html, student.matricula, { studentName: student.name, refId: data.id });
    };
    
    await render();
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
