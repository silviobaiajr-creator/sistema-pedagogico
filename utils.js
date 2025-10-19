// ARQUIVO: utils.js
// Responsabilidade: Funções pequenas e reutilizáveis (helpers).

export const formatDate = (dateString) => dateString ? new Date(dateString).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '';
export const formatTime = (timeString) => timeString || '';
export const formatText = (text) => text ? text.replace(/</g, "&lt;").replace(/>/g, "&gt;") : 'Não informado';
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

export const openModal = (modalElement) => {
    modalElement.classList.remove('hidden');
    setTimeout(() => {
        modalElement.classList.remove('opacity-0');
        modalElement.firstElementChild.classList.remove('scale-95', 'opacity-0');
    }, 10);
};

export const closeModal = (modalElement) => {
    if (!modalElement) return;
    modalElement.classList.add('opacity-0');
    modalElement.firstElementChild.classList.add('scale-95', 'opacity-0');
    setTimeout(() => modalElement.classList.add('hidden'), 300);
};

export const enhanceTextForSharing = (title, text) => {
    let enhancedText = text;

    if (title.toLowerCase().includes('ocorrência')) {
        enhancedText = `*📢 NOTIFICAÇÃO DE OCORRÊNCIA ESCOLAR 📢*\n\n${text}`;
    } else if (title.toLowerCase().includes('relatório')) {
        enhancedText = `*📋 RELATÓRIO DE OCORRÊNCIAS 📋*\n\n${text}`;
    } else if (title.toLowerCase().includes('ficha')) {
        enhancedText = `*📈 FICHA DE ACOMPANHAMENTO 📈*\n\n${text}`;
    }

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
            showToast('Erro ao partilhar o conteúdo.');
        }
    } else {
        const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(enhancedText)}`;
        window.open(whatsappUrl, '_blank');
    }
};

