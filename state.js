// ARQUIVO: state.js
// Responsabilidade: Guardar o estado global e os elementos do DOM.
// ATUALIZAÇÃO: Adicionados estados para os novos filtros de ocorrência (tipo e status)
// e para gerenciar a seleção de múltiplos alunos no modal de ocorrência.

export const state = {
    students: [],
    occurrences: [],
    absences: [],
    filterOccurrences: '', // Filtro de busca por nome de aluno
    filtersOccurrences: {
        startDate: null,
        endDate: null,
        type: 'all', // NOVO: Filtro por tipo de ocorrência
        status: 'all'  // NOVO: Filtro por status
    },
    filterAbsences: '',
    filtersAbsences: {
        processStatus: 'all',
        pendingAction: 'all',
        returnStatus: 'all'
    },
    activeTab: 'occurrences',
    recordToDelete: null,
    db: null,
    userId: null,
    userEmail: null,
    unsubscribeOccurrences: null,
    unsubscribeAbsences: null,
    selectedStudents: new Map() // NOVO: Gerencia os alunos selecionados no modal Map<studentId, studentName>
};

export const dom = {
    loginScreen: document.getElementById('login-screen'),
    mainContent: document.getElementById('main-content'),
    loginView: document.getElementById('login-view'),
    registerView: document.getElementById('register-view'),
    showRegisterViewBtn: document.getElementById('show-register-view'),
    showLoginViewBtn: document.getElementById('show-login-view'),
    loginForm: document.getElementById('login-form'),
    registerForm: document.getElementById('register-form'),
    logoutBtn: document.getElementById('logout-btn'),
    userProfile: document.getElementById('user-profile'),
    userEmail: document.getElementById('user-email'),
    occurrenceModal: document.getElementById('occurrence-modal'),
    absenceModal: document.getElementById('absence-modal'),
    studentsModal: document.getElementById('students-modal'),
    notificationModalBackdrop: document.getElementById('notification-modal-backdrop'),
    deleteConfirmModal: document.getElementById('delete-confirm-modal'),
    reportGeneratorModal: document.getElementById('report-generator-modal'),
    reportViewModalBackdrop: document.getElementById('report-view-modal-backdrop'),
    fichaViewModalBackdrop: document.getElementById('ficha-view-modal-backdrop'),
    occurrencesListDiv: document.getElementById('occurrences-list'),
    absencesListDiv: document.getElementById('absences-list'),
    emptyStateOccurrences: document.getElementById('empty-state-occurrences'),
    emptyStateAbsences: document.getElementById('empty-state-absences'),
    loadingOccurrences: document.getElementById('loading-occurrences'),
    loadingAbsences: document.getElementById('loading-absences'),
    occurrenceForm: document.getElementById('occurrence-form'),
    absenceForm: document.getElementById('absence-form'),
    tabOccurrences: document.getElementById('tab-occurrences'),
    tabAbsences: document.getElementById('tab-absences'),
    tabContentOccurrences: document.getElementById('tab-content-occurrences'),
    tabContentAbsences: document.getElementById('tab-content-absences'),
    searchOccurrences: document.getElementById('search-occurrences'),
    searchAbsences: document.getElementById('search-absences'),
    occurrencesTitle: document.getElementById('occurrences-title'),
    occurrenceStartDate: document.getElementById('occurrence-start-date'),
    occurrenceEndDate: document.getElementById('occurrence-end-date'),
    generalReportBtn: document.getElementById('general-report-btn'),
};
