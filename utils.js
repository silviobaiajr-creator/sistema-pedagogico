
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

// --- COMPRESSOR DE IMAGEM OTIMIZADO (HARDWARE LIMIT SAFE) ---
export const compressImage = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            
            img.onload = () => {
                // Dimensões originais
                let width = img.width;
                let height = img.height;

                // --- LIMITES DE HARDWARE DO NAVEGADOR ---
                // A maioria dos navegadores móveis (iOS Safari / Android Chrome) tem um limite
                // de altura para o Canvas em torno de 4096px. Acima disso, a imagem fica branca ou preta.
                const MAX_CANVAS_HEIGHT = 4096; 
                const MAX_WIDTH = 1200; // Largura boa para leitura em desktop

                // 1. Redimensionamento baseado na Altura (Crítico para Prints Longos)
                if (height > MAX_CANVAS_HEIGHT) {
                    const ratio = MAX_CANVAS_HEIGHT / height;
                    width = width * ratio;
                    height = MAX_CANVAS_HEIGHT;
                }

                // 2. Redimensionamento baseado na Largura (Otimização de tamanho)
                if (width > MAX_WIDTH) {
                    const ratio = MAX_WIDTH / width;
                    width = MAX_WIDTH;
                    height = height * ratio;
                }

                // Arredonda para inteiros
                width = Math.floor(width);
                height = Math.floor(height);

                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');

                    // --- CORREÇÃO DE FUNDO TRANSPARENTE/PRETO ---
                    // Prints PNG podem ter fundo transparente que vira preto no JPEG.
                    // Pintamos o canvas de branco primeiro.
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(0, 0, width, height);

                    // Desenha a imagem redimensionada
                    ctx.drawImage(img, 0, 0, width, height);

                    // Exporta para JPEG com qualidade média (0.7) para economizar dados
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                    
                    // Validação final
                    if (dataUrl.length < 100 || dataUrl === 'data:,') {
                        throw new Error("O navegador não conseguiu processar esta imagem.");
                    }
                    
                    resolve(dataUrl);
                } catch (e) {
                    console.error("Erro crítico na renderização do canvas:", e);
                    reject(new Error("A imagem é muito grande para este dispositivo. Tente cortá-la."));
                }
            };
            
            img.onerror = () => reject(new Error("Arquivo de imagem inválido ou corrompido."));
        };
        
        reader.onerror = () => reject(new Error("Erro ao ler o arquivo."));
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
