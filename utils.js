
// =================================================================================
// ARQUIVO: utils.js 

import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { storage } from './firebase.js';

export const formatDate = (val) => {
    if (!val) return '';
    const d = val && val.toDate ? val.toDate() : new Date(val);
    return isNaN(d) ? '' : d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
};
export const formatTime = (timeString) => timeString || '';

export const formatText = (text) => {
    if (text == null) return 'Não informado';
    const textAsString = String(text);
    if (textAsString.trim() === '') return 'Não informado';
    return textAsString.replace(/</g, "&lt;").replace(/>/g, "&gt;");
};

export const formatPeriodo = (start, end) => {
    if (start && end) return `de ${formatDate(start)} a ${formatDate(end)}`;
    if (start) return `a partir de ${formatDate(start)}`;
    if (end) return `até ${formatDate(end)}`;
    return 'Não informado';
}

// --- SISTEMA HÍBRIDO DE NOTIFICAÇÃO ---

export const showToast = (message) => {
    const toastMessage = document.getElementById('toast-message');
    const toastEl = document.getElementById('toast-notification');

    if (toastMessage && toastEl) {
        toastMessage.textContent = message;
        toastEl.classList.add('show');
        setTimeout(() => toastEl.classList.remove('show'), 3000);
    }
};

export const showAlert = (message) => {
    const alertModal = document.getElementById('alert-modal');
    const messageEl = document.getElementById('alert-modal-message');
    const okBtn = document.getElementById('alert-modal-ok-btn');

    if (alertModal && messageEl) {
        messageEl.textContent = message;
        const closeAlert = () => closeModal(alertModal);
        okBtn.onclick = closeAlert;
        openModal(alertModal);
    } else {
        alert(message);
    }
};

// ==============================================================================
// --- LÓGICA DE MODAIS E IMPRESSÃO ---
// ==============================================================================

export const openModal = (modalElement) => {
    if (!modalElement) return console.error("Tentativa de abrir um modal nulo.");
    document.querySelectorAll('.printable-area-active').forEach(el => {
        el.classList.remove('printable-area-active');
    });
    if (modalElement.classList.contains('printable-area')) {
        modalElement.classList.add('printable-area-active');
    }
    modalElement.classList.remove('hidden');
    setTimeout(() => {
        modalElement.classList.remove('opacity-0');
        if (modalElement.firstElementChild) {
            modalElement.firstElementChild.classList.remove('scale-95', 'opacity-0');
        }
    }, 10);
};

export const closeModal = (modalElement) => {
    if (!modalElement) return;
    if (modalElement.classList.contains('printable-area')) {
        modalElement.classList.remove('printable-area-active');
    }
    modalElement.classList.add('opacity-0');
    if (modalElement.firstElementChild) {
        modalElement.firstElementChild.classList.add('scale-95', 'opacity-0');
    }
    setTimeout(() => modalElement.classList.add('hidden'), 300);
};

// --- VISUALIZADOR DE MÍDIA (Imagem/Video) ---
export const openImageModal = (src, title = 'Anexo') => {
    const modal = document.getElementById('image-view-modal');
    const container = document.querySelector('#image-view-modal .p-4');
    const titleEl = document.getElementById('image-view-title');

    if (modal && container) {
        if (titleEl) titleEl.textContent = title;

        container.innerHTML = '';
        container.className = "p-4 overflow-auto flex justify-center bg-black/5 items-center min-h-[200px]";

        const isVideo = src.includes('.mp4') || src.includes('.webm') || src.includes('.mov');
        const isAudio = src.includes('.mp3') || src.includes('.wav') || src.includes('.ogg');

        if (isVideo) {
            const video = document.createElement('video');
            video.src = src;
            video.controls = true;
            video.className = "max-w-full h-auto max-h-[80vh] rounded shadow-sm";
            container.appendChild(video);
        } else if (isAudio) {
            const audio = document.createElement('audio');
            audio.src = src;
            audio.controls = true;
            audio.className = "w-full max-w-md mt-4";
            container.appendChild(audio);
        } else {
            const img = document.createElement('img');
            img.src = src;
            img.className = "max-w-full h-auto max-h-[80vh] rounded shadow-sm";
            img.alt = "Anexo";
            container.appendChild(img);
        }

        openModal(modal);
    }
};

// ==============================================================================
// --- UPLOAD PARA FIREBASE STORAGE ---
// ==============================================================================

export const uploadToStorage = async (file, folder = 'uploads') => {
    if (!storage) throw new Error("Serviço de Armazenamento não configurado.");

    const cleanName = file.name.replace(/[^a-zA-Z0-9.]/g, "_");
    const fileName = `${Date.now()}_${cleanName}`;
    const storageRef = ref(storage, `${folder}/${fileName}`);

    try {
        const snapshot = await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);
        return downloadURL;
    } catch (error) {
        console.error("Erro no upload (Detalhes):", error);

        // Detecção amigável de erro de CORS
        if (error.message && (error.message.includes('CORS') || error.message.includes('network') || error.code === 'storage/unknown')) {
            throw new Error("Bloqueio de Segurança (CORS): O Firebase impediu o upload. Configure o CORS no console do Google Cloud conforme as instruções.");
        } else if (error.code === 'storage/unauthorized') {
            throw new Error("Permissão Negada: Verifique as regras (Rules) do Storage no console do Firebase.");
        }

        throw new Error("Falha ao enviar arquivo para a nuvem. Verifique sua conexão.");
    }
};

// Mantido para compatibilidade, mas idealmente deve ser substituído pelo uploadToStorage
export const compressImage = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = async (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const MAX_DIMENSION = 1024;
                if (width > height) {
                    if (width > MAX_DIMENSION) { height *= MAX_DIMENSION / width; width = MAX_DIMENSION; }
                } else {
                    if (height > MAX_DIMENSION) { width *= MAX_DIMENSION / height; height = MAX_DIMENSION; }
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.7));
            };
        };
        reader.onerror = (err) => reject(err);
    });
};

window.onbeforeprint = () => {
    const allPrintables = document.querySelectorAll('.printable-area');
    allPrintables.forEach(el => el.classList.remove('printable-area-active'));
    allPrintables.forEach(el => {
        if (!el.classList.contains('hidden')) {
            el.classList.add('printable-area-active');
        }
    });
};

export const getStatusBadge = (status) => {
    const statusMap = {
        'Pendente': 'bg-yellow-100 text-yellow-800',
        'Aguardando Contato': 'bg-blue-100 text-blue-800',
        'Finalizada': 'bg-green-100 text-green-800',
        'Resolvido': 'bg-green-100 text-green-800',
        'Cancelado': 'bg-gray-100 text-gray-800'
    };
    const colorClasses = statusMap[status] || 'bg-gray-100 text-gray-800';
    return `<span class="text-xs font-medium px-2.5 py-0.5 rounded-full ${colorClasses}">${status || 'N/A'}</span>`;
};

export const enhanceTextForSharing = (title, text) => {
    let enhancedText = text;
    if (title.toLowerCase().includes('ocorrência')) enhancedText = `*📢 NOTIFICAÇÃO DE OCORRÊNCIA ESCOLAR 📢*\n\n${text}`;
    else if (title.toLowerCase().includes('relatório')) enhancedText = `*📋 RELATÓRIO DE OCORRÊNCIAS 📋*\n\n${text}`;
    else if (title.toLowerCase().includes('ficha')) enhancedText = `*📈 FICHA DE ACOMPANHAMENTO 📈*\n\n${text}`;
    enhancedText = enhancedText.replace(/Aos Responsáveis/g, '👥 Aos Responsáveis');
    enhancedText = enhancedText.replace(/Aluno\(a\):/g, '👤 Aluno(a):');
    enhancedText = enhancedText.replace(/Turma:/g, '🏫 Turma:');
    enhancedText = enhancedText.replace(/Data:/g, '🗓️ Data:');
    enhancedText = enhancedText.replace(/Horário:/g, '⏰ Horário:');
    enhancedText = enhancedText.replace(/Descrição:/g, '📝 Descrição:');
    enhancedText += `\n\n-------------\n_Mensagem enviada pelo Sistema de Acompanhamento Pedagógico._`;
    return enhancedText;
};

export const shareContent = async (title, text) => {
    const enhancedText = enhanceTextForSharing(title, text);
    if (navigator.share) {
        try {
            await navigator.share({ title, text: enhancedText });
        } catch (error) {
            console.error('Erro ao partilhar:', error);
            showAlert('Erro ao partilhar o conteúdo.');
        }
    } else {
        const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(enhancedText)}`;
        window.open(whatsappUrl, '_blank');
    }
};

export const loadScript = (url) => {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${url}"]`)) {
            return resolve();
        }
        const script = document.createElement('script');
        script.src = url;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Falha ao carregar o script: ${url}`));
        document.body.appendChild(script);
    });
};
