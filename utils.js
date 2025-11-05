// =================================================================================
// ARQUIVO: utils.js 

export const formatDate = (dateString) => dateString ? new Date(dateString).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '';
export const formatTime = (timeString) => timeString || '';

// CORRIGIDO: Garante que 'text' seja tratado como string
export const formatText = (text) => {
    // Verifica se text é null ou undefined primeiro
    if (text == null) { // Usar == null cobre undefined também
        return 'Não informado';
    }
    // Converte explicitamente para string ANTES de usar replace
    const textAsString = String(text);
    // Remove espaços em branco extras antes de verificar se está vazio
    if (textAsString.trim() === '') {
        return 'Não informado';
    }
    // Agora é seguro usar replace
    return textAsString.replace(/</g, "&lt;").replace(/>/g, "&gt;");
};

export const formatPeriodo = (start, end) => {
    if (start && end) return `de ${formatDate(start)} a ${formatDate(end)}`;
    if (start) return `a partir de ${formatDate(start)}`;
    if (end) return `até ${formatDate(end)}`;
    return 'Não informado';
}

export const showToast = (message) => {
    const toastMessage = document.getElementById('toast-message');
    toastMessage.textContent = message;
    document.getElementById('toast-notification').classList.add('show');
    setTimeout(() => document.getElementById('toast-notification').classList.remove('show'), 3000);
};

// ==============================================================================
// --- (INÍCIO DA CORREÇÃO - LÓGICA DE IMPRESSÃO INTERMITENTE) ---
// ==============================================================================

// Lista dos IDs dos modais que podem ser impressos.
// Precisamos disto para "limpar" os outros modais antes de abrir um novo.
const printableModalIds = [
    'notification-modal-backdrop',
    'report-view-modal-backdrop',
    'ficha-view-modal-backdrop'
];

export const openModal = (modalElement) => {
     // Garante que modalElement não seja nulo
     if (!modalElement) {
         console.error("Tentativa de abrir um modal nulo.");
         return;
     }
     
     // --- NOVO: Lógica de Limpeza de Impressão ---
     // Verifica se o modal que estamos abrindo é um modal de impressão
     // (Verifica pela classe base 'printable-area')
     const isPrintable = modalElement.classList.contains('printable-area');
     
     if (isPrintable) {
         // É um modal de impressão.
         // Remove a classe 'printable-area-active' de TODOS os outros modais
         // para evitar que apareçam na impressão por engano.
         printableModalIds.forEach(id => {
             // Não mexer no modal atual, mesmo que esteja na lista
             if (modalElement.id === id) return; 
             
             const otherModal = document.getElementById(id);
             if (otherModal) {
                 otherModal.classList.remove('printable-area-active'); 
             }
         });
         // Adiciona a classe ativa *apenas* neste modal
         modalElement.classList.add('printable-area-active');
     }
     // --- FIM DA LÓGICA DE IMPRESSÃO ---

    modalElement.classList.remove('hidden');
    setTimeout(() => {
        modalElement.classList.remove('opacity-0');
        // Garante que firstElementChild existe
        if (modalElement.firstElementChild) {
            modalElement.firstElementChild.classList.remove('scale-95', 'opacity-0');
        }
    }, 10);
};

export const closeModal = (modalElement) => {
    if (!modalElement) return;

     // --- NOVO: Lógica de Limpeza de Impressão ---
     // Ao fechar, remove a classe ativa para que não seja impresso
     // da próxima vez por acidente.
    if (modalElement.classList.contains('printable-area')) {
         modalElement.classList.remove('printable-area-active');
    }
     // --- FIM DA LÓGICA DE IMPRESSÃO ---
    
    modalElement.classList.add('opacity-0');
    // Garante que firstElementChild existe
    if (modalElement.firstElementChild) {
        modalElement.firstElementChild.classList.add('scale-95', 'opacity-0');
    }
    setTimeout(() => modalElement.classList.add('hidden'), 300);
};

// ==============================================================================
// --- (FIM DA CORREÇÃO) ---
// ==============================================================================


/**
 * Retorna o HTML para um selo (badge) de status.
 * @param {string} status - O status ('Pendente', 'Finalizada', 'Aguardando Contato', etc.)
 * @returns {string} HTML do selo de status.
 */
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
    // ... (função inalterada)
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
    // ... (função inalterada)
    const enhancedText = enhanceTextForSharing(title, text);
    if (navigator.share) {
        try {
            await navigator.share({ title, text: enhancedText });
        } catch (error) {
            console.error('Erro ao partilhar:', error);
            showToast('Erro ao partilhar o conteúdo.');
        }
    } else {
        const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(enhancedText)}`;
        window.open(whatsappUrl, '_blank');
    }
};

export const loadScript = (url) => {
  // ... (função inalterada)
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
