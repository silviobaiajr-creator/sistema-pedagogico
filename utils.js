
// =================================================================================
// ARQUIVO: utils.js 

export const formatDate = (dateString) => dateString ? new Date(dateString).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '';
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

// 1. TOAST (Para Sucesso/Info) - Canto inferior direito
export const showToast = (message) => {
    const toastMessage = document.getElementById('toast-message');
    const toastEl = document.getElementById('toast-notification');
    
    if (toastMessage && toastEl) {
        toastMessage.textContent = message;
        toastEl.classList.add('show');
        setTimeout(() => toastEl.classList.remove('show'), 3000);
    }
};

// 2. ALERT (Para Erros/Validação) - Modal Centralizado
export const showAlert = (message) => {
    const alertModal = document.getElementById('alert-modal');
    const messageEl = document.getElementById('alert-modal-message');
    const okBtn = document.getElementById('alert-modal-ok-btn');

    if (alertModal && messageEl) {
        messageEl.textContent = message;
        
        // Garante que o listener não se acumule
        const closeAlert = () => closeModal(alertModal);
        okBtn.onclick = closeAlert;
        
        openModal(alertModal);
    } else {
        alert(message); // Fallback
    }
};

// ==============================================================================
// --- LÓGICA DE MODAIS E IMPRESSÃO ROBUSTA ---
// ==============================================================================

export const openModal = (modalElement) => {
     if (!modalElement) return console.error("Tentativa de abrir um modal nulo.");
     
     // Limpeza agressiva: Remove a classe ativa de TODOS os modais antes de abrir um novo
     document.querySelectorAll('.printable-area-active').forEach(el => {
         el.classList.remove('printable-area-active');
     });
     
     // Se o modal atual for de impressão, marca ele
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

    // Ao fechar, remove imediatamente a marcação de impressão
    if (modalElement.classList.contains('printable-area')) {
         modalElement.classList.remove('printable-area-active');
    }
    
    modalElement.classList.add('opacity-0');
    if (modalElement.firstElementChild) {
        modalElement.firstElementChild.classList.add('scale-95', 'opacity-0');
    }
    setTimeout(() => modalElement.classList.add('hidden'), 300);
};

// --- VISUALIZADOR DE IMAGEM (PRINT) ---
export const openImageModal = (base64Image, title = 'Anexo') => {
    const modal = document.getElementById('image-view-modal');
    const imgEl = document.getElementById('image-view-content');
    const titleEl = document.getElementById('image-view-title');
    
    if (modal && imgEl) {
        imgEl.src = base64Image;
        if(titleEl) titleEl.textContent = title;
        openModal(modal);
    }
};

// --- COMPRESSOR DE IMAGEM (Para salvar no Firestore sem estourar limite) ---
export const compressImage = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                // Redimensiona para max 800px de largura para economizar espaço
                const MAX_WIDTH = 800;
                const scaleSize = MAX_WIDTH / img.width;
                
                if (img.width > MAX_WIDTH) {
                    canvas.width = MAX_WIDTH;
                    canvas.height = img.height * scaleSize;
                } else {
                    canvas.width = img.width;
                    canvas.height = img.height;
                }
                
                const ctx = canvas.getContext('2d');
                
                // CORREÇÃO CRÍTICA PARA PRINTS DE WHATSAPP (PNG -> JPEG = PRETO)
                // Preenche o fundo com branco antes de desenhar a imagem
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                // Compressa para JPEG qualidade 0.7 (Um pouco melhor para texto de print)
                resolve(canvas.toDataURL('image/jpeg', 0.7)); 
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (error) => reject(error);
    });
};


// ==============================================================================
// --- O FISCAL DE IMPRESSÃO (CORREÇÃO NUCLEAR) ---
// ==============================================================================
window.onbeforeprint = () => {
    const allPrintables = document.querySelectorAll('.printable-area');
    allPrintables.forEach(el => el.classList.remove('printable-area-active'));
    allPrintables.forEach(el => {
        if (!el.classList.contains('hidden')) {
            el.classList.add('printable-area-active');
        }
    });
};
// ==============================================================================


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
    enhancedText = enhancedText.replace(/Providências da Escola:/g, '🏛️ Providências da Escola:');
    enhancedText = enhancedText.replace(/Providências da Família:/g, '👨‍👩‍👧‍👦 Providências da Família:');
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
