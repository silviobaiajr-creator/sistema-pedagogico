


// =================================================================================
// ARQUIVO: dashboard.js
// VERSÃO: 2.1 (Alertas Clicáveis e Porcentagens)

import { getDashboardStats } from './firestore.js';
import { dom, state } from './state.js';
import { formatDate } from './utils.js';

let chartTypes = null;
let chartStatus = null;
let activeFilters = { year: 'all', class: 'all', shift: 'all' };

export const initDashboard = async () => {
    // Estado de Loading
    const loadingIcon = '<i class="fas fa-spinner fa-spin text-sm"></i>';
    document.getElementById('dash-total-students').innerHTML = loadingIcon;
    document.getElementById('dash-total-occurrences').innerHTML = loadingIcon;
    document.getElementById('dash-active-absences').innerHTML = loadingIcon;
    
    // Mostra barra de filtros
    const filtersDiv = document.getElementById('dashboard-global-filters');
    if (filtersDiv) {
        filtersDiv.classList.remove('hidden');
        setupDashboardFilterListeners();
    }

    // Refresh Data com Filtros Atuais
    await refreshDashboardData();
};

const setupDashboardFilterListeners = () => {
    document.getElementById('apply-dash-filters-btn').onclick = () => {
        activeFilters.year = document.getElementById('filter-dash-year').value;
        activeFilters.class = document.getElementById('filter-dash-class').value;
        activeFilters.shift = document.getElementById('filter-dash-shift').value;
        refreshDashboardData();
    };
    
    document.getElementById('clear-dash-filters-btn').onclick = () => {
        document.getElementById('filter-dash-year').value = 'all';
        document.getElementById('filter-dash-class').value = 'all';
        document.getElementById('filter-dash-shift').value = 'all';
        activeFilters = { year: 'all', class: 'all', shift: 'all' };
        refreshDashboardData();
    };
};

const refreshDashboardData = async () => {
    // Recarrega estatísticas (simulado filtro em memória pois firestore.js retorna tudo ou counts)
    // NOTA: Idealmente o getDashboardStats aceitaria filtros na query. 
    // Como getCountFromServer é global, faremos uma aproximação baseada em state.occurrences se disponível,
    // ou manteremos os Cards totais e filtraremos apenas os gráficos e listas de alerta.
    
    const stats = await getDashboardStats(); 

    if (!stats) {
        document.getElementById('dash-total-students').textContent = 'Erro';
        return;
    }

    // --- APLICAÇÃO DE FILTROS (Memória/Simulação) ---
    // Precisamos filtrar stats.chartDataOccurrences e stats.chartDataAbsences baseado nos dados do aluno.
    // Como os gráficos usam listas pequenas, podemos filtrar aqui.
    // Para os Totais (Cards), se quisermos precisão, teríamos que baixar tudo. 
    // Por enquanto, vamos manter Totais Globais ou Tentar Filtrar se o dado do aluno estiver anexado.

    // Carregar alunos para cruzar dados de turma/turno se necessário
    // Se state.students estiver vazio, carregue-os (pode ser pesado, cuidado)
    /* 
       Optim: Gráficos serão filtrados.
       Cards: Serão globais (avisar usuário) ou 
       filtrados se tivermos cache.
    */

    let filteredOccurrences = stats.chartDataOccurrences; // Array de amostra (50)
    let filteredAbsences = stats.chartDataAbsences;

    // Filtra ocorrências (precisa buscar dados do aluno se não estiverem no objeto da ocorrência)
    // occurrences usually have studentName and studentId. We need student Class/Shift.
    // We will trust 'studentClass' if saved in occurrence, or look up in state.students.
    
    // Filtro Lógico:
    const matchesFilter = (itemClass, itemShift, itemYear) => {
        // Normalização simples
        const iClass = itemClass ? itemClass.toUpperCase() : '';
        // Turno/Ano podem não estar salvos explicitamente na ocorrência antiga.
        // Se crítico, precisaria fazer join. Assumiremos que 'studentClass' contém ex "9A" => Ano 9, Turma A.
        // Implementação heurística:
        
        // Ano: Pega números de itemClass (ex: "9A" -> "9")
        // Turma: Pega letras (ex: "9A" -> "A")
        
        // Se o filtro for 'all', passa.
        let passYear = activeFilters.year === 'all';
        let passClass = activeFilters.class === 'all';
        let passShift = activeFilters.shift === 'all';
        
        if (!passYear || !passClass) {
             const digits = iClass.replace(/\D/g, '');
             const letters = iClass.replace(/[^a-zA-Z]/g, '');
             
             if (!passYear && digits !== activeFilters.year) passYear = false;
             if (!passClass && !letters.includes(activeFilters.class)) passClass = false;
        }

        // Turno: Difícil sem campo explícito. Se não tem campo 'shift', ignora filtro ou reprova?
        // Vamos ignorar filtro de turno por enquanto se não houver dados, ou implementar no student.js
        if (!passShift) {
             // Placeholder: Tentar verificar se existe propriedade shift ou inferir
             // passShift = false; // Rigoroso
             passShift = true; // Permissivo por falta de dado
        }
        
        return passYear && passClass && passShift;
    };

    filteredOccurrences = filteredOccurrences.filter(o => matchesFilter(o.studentClass));
    filteredAbsences = filteredAbsences.filter(a => matchesFilter(a.studentClass)); // Assumindo campo studentClass em absence
    
    // Alunos
    animateValue('dash-total-students', 0, stats.totalStudents, 800);

    // Ocorrências (Incidência Aproximada)
    animateValue('dash-total-occurrences', 0, stats.totalOccurrences, 800);
    const incidentRate = stats.totalStudents > 0 
        ? ((stats.totalOccurrences / stats.totalStudents) * 100).toFixed(1) 
        : 0;
    
    const occCard = document.getElementById('dash-total-occurrences').parentElement;
    // Remove texto antigo se existir
    const oldOccContext = occCard.querySelector('.context-stat');
    if (oldOccContext) oldOccContext.remove();
    
    const occContextHtml = `<p class="context-stat text-xs text-yellow-600 mt-1 font-medium"><i class="fas fa-chart-line"></i> ~${incidentRate}% de incidência</p>`;
    occCard.insertAdjacentHTML('beforeend', occContextHtml);

    // Busca Ativa (Taxa de Sucesso)
    animateValue('dash-active-absences', 0, stats.totalAbsences, 800);
    const successRate = stats.totalAbsences > 0
        ? ((stats.concludedAbsences / stats.totalAbsences) * 100).toFixed(1)
        : 0;
        
    const absCard = document.getElementById('dash-active-absences').parentElement;
    const oldAbsContext = absCard.querySelector('.context-stat');
    if (oldAbsContext) oldAbsContext.remove();

    const absContextHtml = `<p class="context-stat text-xs text-emerald-600 mt-1 font-medium"><i class="fas fa-check-circle"></i> ${successRate}% resolvidos</p>`;
    absCard.insertAdjacentHTML('beforeend', absContextHtml);


    // 2. Renderiza Alertas / Gestão Rápida (Expandido)
    // Passar filtros para alertas também? Sim.
    renderUrgentAlerts(activeFilters);

    // 3. Renderiza Gráficos (Usando dados filtrados)
    renderCharts(filteredOccurrences, filteredAbsences);
};

const renderUrgentAlerts = async (filters) => {
    // Busca dados reais do state (cache) para alertas, pois stats só traz amostra
    // Precisamos garantir que state.occurrences tenha dados.
    if (!state.occurrences || state.occurrences.length === 0) {
        // Se vazio, não renderiza ou tenta fetch (evitar loop infinito)
    }

    const today = new Date();
    
    // Filtro auxiliar para os itens de lista
    const filterItem = (item) => {
        let passYear = filters.year === 'all';
        let passClass = filters.class === 'all';
        // logica de filtro de turma repetida
        if (!passYear || !passClass) {
             const iClass = item.studentClass ? item.studentClass.toUpperCase() : '';
             const digits = iClass.replace(/\D/g, '');
             const letters = iClass.replace(/[^a-zA-Z]/g, '');
             if (!passYear && digits !== filters.year) passYear = false;
             if (!passClass && !letters.includes(filters.class)) passClass = false;
        }
        return passYear && passClass;
    }

    // LISTAS DE GESTÃO RÁPIDA
    
    // 1. Assinaturas Pendentes (Próximo de vencer ou antigas)
    const pendingSignatures = state.occurrences
        .filter(o => o.statusIndividual === 'Pendente' && !o.isSigned)
        .filter(filterItem)
        .slice(0, 5);

    // 2. Busca Ativa Parada (Sem movimentação > 5 dias)
    const stalledAbsences = state.absences
        .filter(a => a.actionType !== 'analise') 
        .filter(a => {
            const date = a.updatedAt ? (a.updatedAt.toDate ? a.updatedAt.toDate() : new Date(a.updatedAt)) : new Date(a.createdAt); // Fallback createdAt
            const diffTime = Math.abs(today - date);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            return diffDays > 5;
        })
        .filter(filterItem)
        .slice(0, 5);

    if (pendingSignatures.length === 0 && stalledAbsences.length === 0) {
        const existing = document.getElementById('urgent-alerts-container');
        if(existing) existing.remove();
        return;
    }

    const cardsRow = document.querySelector('#tab-content-dashboard > .grid:first-child');
    const existingContainer = document.getElementById('urgent-alerts-container');
    if(existingContainer) existingContainer.remove();

    const alertSection = document.createElement('div');
    alertSection.id = 'urgent-alerts-container';
    alertSection.className = 'mb-8 bg-sky-50 border border-sky-200 rounded-lg p-4 shadow-sm';
    
    let alertsHtml = `<div class="flex justify-between items-center mb-4"><h3 class="text-md font-bold text-sky-800 uppercase"><i class="fas fa-tasks mr-2"></i> Gestão Rápida / Pendências</h3></div><div class="grid grid-cols-1 md:grid-cols-2 gap-6">`;

    // BLOCO 1: ASSINATURAS / OCORRÊNCIAS
    if (pendingSignatures.length > 0) {
        alertsHtml += `
            <div>
                <h4 class="text-sm font-semibold text-orange-700 mb-2 border-b border-orange-200 pb-1">Assinaturas / Pendentes</h4>
                <ul class="space-y-2">
                    ${pendingSignatures.map(o => `
                        <li class="bg-white p-3 rounded border-l-4 border-orange-400 shadow-sm text-xs flex justify-between items-center cursor-pointer hover:bg-orange-50 dashboard-jump-link transition" 
                            data-tab="occurrences" data-student-name="${o.studentName}">
                            <div>
                                <span class="font-bold text-gray-800 block">${o.studentName}</span>
                                <span class="text-gray-500">${o.occurrenceType}</span>
                            </div>
                            <div class="text-right">
                                <span class="block font-mono text-orange-600 text-[10px] uppercase">Aguardando Assinatura</span>
                                <span class="text-gray-400">${formatDate(o.date)}</span>
                            </div>
                        </li>
                    `).join('')}
                </ul>
            </div>`;
    } else {
         alertsHtml += `<div class="text-center py-4 text-gray-400 text-sm">Nenhuma ocorrência pendente de assinatura.</div>`;
    }

    // BLOCO 2: BUSCA ATIVA PARADA
    if (stalledAbsences.length > 0) {
        alertsHtml += `
            <div>
                <h4 class="text-sm font-semibold text-red-700 mb-2 border-b border-red-200 pb-1">Busca Ativa Parada (+5 dias)</h4>
                <ul class="space-y-2">
                    ${stalledAbsences.map(a => {
                         const date = a.updatedAt?.toDate ? a.updatedAt.toDate() : (a.createdAt?.toDate ? a.createdAt.toDate() : new Date());
                         return `
                        <li class="bg-white p-3 rounded border-l-4 border-red-500 shadow-sm text-xs flex justify-between items-center cursor-pointer hover:bg-red-50 dashboard-jump-link transition" 
                            data-tab="absences" data-student-name="${a.studentName}">
                            <div>
                                <span class="font-bold text-gray-800 block">${a.studentName || 'Aluno'}</span>
                                <span class="text-gray-500">Etapa: ${a.actionType || 'Inicial'}</span>
                            </div>
                            <div class="text-right">
                                <span class="block font-mono text-red-600 text-[10px] uppercase">Sem Movimentação</span>
                                <span class="text-gray-400">${formatDate(date)}</span>
                            </div>
                        </li>
                    `}).join('')}
                </ul>
            </div>`;
    } else {
        alertsHtml += `<div class="text-center py-4 text-gray-400 text-sm">Nenhuma busca ativa parada.</div>`;
    }
    
    alertsHtml += `</div>`;
    alertSection.innerHTML = alertsHtml;
    
    if(cardsRow) cardsRow.parentNode.insertBefore(alertSection, cardsRow.nextSibling);
}

const animateValue = (id, start, end, duration) => {
    const obj = document.getElementById(id);
    if(!obj) return;
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
};

const renderCharts = (occurrences, absences) => {
    // Gráfico 1: Tipos de Ocorrência (Top 5)
    const typesCount = {};
    occurrences.forEach(o => {
        const type = o.occurrenceType || 'Outros';
        typesCount[type] = (typesCount[type] || 0) + 1;
    });
    
    const sortedTypes = Object.entries(typesCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    const ctxTypes = document.getElementById('dash-chart-types').getContext('2d');
    if (chartTypes) chartTypes.destroy();

    const totalTypes = sortedTypes.reduce((acc, curr) => acc + curr[1], 0);

    chartTypes = new Chart(ctxTypes, {
        type: 'doughnut',
        data: {
            labels: sortedTypes.map(i => i[0]),
            datasets: [{
                data: sortedTypes.map(i => i[1]),
                backgroundColor: ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'right' },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.raw || 0;
                            const percentage = totalTypes > 0 ? ((value / totalTypes) * 100).toFixed(1) + '%' : '0%';
                            return `${label}: ${value} (${percentage})`;
                        }
                    }
                }
            }
        }
    });

    // Gráfico 2: Status Busca Ativa
    const statusCount = { 'Em Andamento': 0, 'Concluído': 0 };
    absences.forEach(a => {
        if (a.actionType === 'analise') statusCount['Concluído']++;
        else statusCount['Em Andamento']++;
    });

    const ctxStatus = document.getElementById('dash-chart-status').getContext('2d');
    if (chartStatus) chartStatus.destroy();

    chartStatus = new Chart(ctxStatus, {
        type: 'bar',
        data: {
            labels: Object.keys(statusCount),
            datasets: [{
                label: 'Ações',
                data: Object.values(statusCount),
                backgroundColor: ['#f59e0b', '#10b981'],
                borderRadius: 5
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1 } }
            },
            plugins: { 
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.dataset.label || '';
                            const value = context.raw || 0;
                            const total = statusCount['Em Andamento'] + statusCount['Concluído'];
                            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) + '%' : '0%';
                            return `${label}: ${value} (${percentage})`;
                        }
                    }
                }
            }
        }
    });
};