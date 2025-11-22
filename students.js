// =================================================================================
// ARQUIVO: students.js

import { state, dom } from './state.js';
// (CORREÇÃO) Adicionado 'getDoc' que estava em falta e é necessário para o fallback de edição
import { setDoc, doc, writeBatch, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStudentsCollectionRef, loadStudents, searchStudentsByName } from './firestore.js'; 
import { db } from './firebase.js'; 
import { showToast, openModal, loadScript } from './utils.js'; 

// Variável para controlar o debounce da pesquisa
let searchTimeout = null;

/**
 * Renderiza a lista de alunos no modal "Gerir Alunos".
 * (MODIFICADO - V3) Aceita uma lista opcional de alunos para exibir.
 * Se não for passada lista, usa os 'state.students' (que agora são só 10).
 */
const renderStudentsList = (studentsToList = null) => {
    const tableBody = dom.studentsListTable;
    if (!tableBody) return; 

    tableBody.innerHTML = ''; 

    const sourceData = studentsToList || state.students;

    if (sourceData.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="3" class="text-center py-4 text-gray-500">Nenhum aluno encontrado ou carregado.</td></tr>`;
        return;
    }

    // Ordena visualmente (opcional, pois o servidor já ordena, mas bom para buscas locais)
    sourceData.sort((a,b) => a.name.localeCompare(b.name)).forEach(student => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="px-4 py-2 text-sm text-gray-900">${student.name}</td>
            <td class="px-4 py-2 text-sm text-gray-500">${student.class}</td>
            <td class="px-4 py-2 text-right text-sm space-x-2">
                <button class="edit-student-btn text-yellow-600 hover:text-yellow-900" data-id="${student.matricula}" title="Editar">
                    <i class="fas fa-pencil-alt"></i>
                </button>
                <button class="delete-student-btn text-red-600 hover:text-red-900" data-id="${student.matricula}" title="Excluir">
                    <i class="fas fa-trash"></i>
                </button>
            </td>`;
        tableBody.appendChild(row);
    });
};

/**
 * Reseta o formulário de adição/edição de aluno.
 */
const resetStudentForm = () => {
    document.getElementById('student-form-title').textContent = 'Adicionar Novo Aluno';
    dom.studentForm.reset(); 
    document.getElementById('student-id-input').value = '';
    document.getElementById('student-matricula-input').readOnly = false;
    document.getElementById('student-matricula-input').classList.remove('bg-gray-100');
    dom.cancelEditStudentBtn.classList.add('hidden'); 
};

/**
 * (NOVO) Lida com a pesquisa de alunos no servidor com Debounce.
 */
const handleStudentSearch = (e) => {
    const searchTerm = e.target.value;
    
    // Limpa o timeout anterior
    if (searchTimeout) clearTimeout(searchTimeout);

    // Define um novo timeout para buscar apenas quando parar de digitar (300ms)
    searchTimeout = setTimeout(async () => {
        if (!searchTerm) {
            // Se limpar a busca, volta a mostrar a lista inicial (10 alunos)
            renderStudentsList();
            return;
        }

        dom.studentsListTable.innerHTML = `<tr><td colspan="3" class="text-center py-4 text-sky-600"><i class="fas fa-spinner fa-spin mr-2"></i>A pesquisar...</td></tr>`;
        
        try {
            // Busca no servidor usando a função otimizada do firestore.js
            // Agora esta função já trata a primeira letra maiúscula automaticamente!
            const results = await searchStudentsByName(searchTerm);
            renderStudentsList(results);
        } catch (error) {
            console.error("Erro na pesquisa:", error);
            showToast("Erro ao pesquisar alunos.");
            renderStudentsList(); // Restaura lista original em caso de erro
        }
    }, 300);
};


/**
 * Lida com o upload do ficheiro CSV de alunos.
 * (MODIFICADO) Adicionado limite de segurança no upload para não bloquear o browser.
 */
async function handleCsvUpload() {
    const fileInput = dom.csvFile; 
    const feedbackDiv = dom.csvFeedback; 

    if (fileInput.files.length === 0) return showToast("Por favor, selecione um ficheiro CSV.");

    try {
        if (typeof window.Papa === 'undefined') {
            feedbackDiv.innerHTML = `<p class="text-sky-500">A carregar biblioteca de CSV...</p>`; 
            const papaScriptUrl = 'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js';
            await loadScript(papaScriptUrl);
            if (typeof window.Papa === 'undefined') {
                 throw new Error("Falha ao carregar PapaParse dinamicamente.");
            }
            feedbackDiv.innerHTML = '';
        }

        window.Papa.parse(fileInput.files[0], {
            header: true,
            skipEmptyLines: true,
            transformHeader: header => header.toLowerCase().trim().replace(/\s+/g, ''),
            complete: async (results) => {
                if (!results.meta || !results.meta.fields) {
                    feedbackDiv.innerHTML = `<p class="text-red-500">Erro: Não foi possível ler os cabeçalhos do ficheiro CSV.</p>`;
                    return;
                }

                const requiredHeaders = ['matricula', 'nome', 'turma', 'endereco', 'contato', 'resp1', 'resp2'];
                const hasAllHeaders = requiredHeaders.every(h => results.meta.fields.includes(h));
                if (!hasAllHeaders) {
                    feedbackDiv.innerHTML = `<p class="text-red-500">Erro: Faltam colunas. O ficheiro CSV deve conter: ${requiredHeaders.join(', ')}.</p>`;
                    return;
                }

                // Filtra linhas inválidas
                const validStudents = results.data.map(row => ({
                    matricula: row.matricula ? String(row.matricula).trim() : '',
                    name: row.nome ? String(row.nome).trim() : '',
                    class: row.turma || '',
                    endereco: row.endereco || '',
                    contato: row.contato || '',
                    resp1: row.resp1 || '',
                    resp2: row.resp2 || ''
                })).filter(s => s.name && s.matricula);

                if (validStudents.length === 0) {
                     feedbackDiv.innerHTML = `<p class="text-red-500">Nenhum aluno válido encontrado no CSV.</p>`;
                     return;
                }

                // LÓGICA DE BATCH (LOTE)
                const BATCH_SIZE = 450; 
                const chunks = [];
                for (let i = 0; i < validStudents.length; i += BATCH_SIZE) {
                    chunks.push(validStudents.slice(i, i + BATCH_SIZE));
                }

                feedbackDiv.innerHTML = `<p class="text-sky-600">A processar ${validStudents.length} alunos em ${chunks.length} lotes...</p>`;

                const collectionRef = getStudentsCollectionRef();
                let processedCount = 0;

                try {
                    for (const chunk of chunks) {
                        const batch = writeBatch(db);
                        chunk.forEach(student => {
                            const docRef = doc(collectionRef, student.matricula);
                            batch.set(docRef, student);
                        });
                        await batch.commit();
                        processedCount += chunk.length;
                        feedbackDiv.innerHTML = `<p class="text-sky-600">Salvo lote de ${processedCount}/${validStudents.length} alunos...</p>`;
                    }

                    // Recarrega a lista inicial (10 alunos) para atualizar a UI
                    await loadStudents();
                    
                    renderStudentsList();
                    showToast(`${processedCount} alunos importados/atualizados com sucesso!`);
                    fileInput.value = '';
                    feedbackDiv.innerHTML = `<p class="text-green-600 font-bold">Importação concluída com sucesso!</p>`;
                    setTimeout(() => feedbackDiv.innerHTML = '', 5000);

                } catch(error) {
                    console.error("Erro ao salvar lote no Firestore:", error);
                    let msg = error.message;
                    if (error.code === 'permission-denied' || msg.includes("Missing or insufficient permissions")) {
                        msg = "Permissão negada! Verifique firestore.rules.";
                    }
                    feedbackDiv.innerHTML = `<p class="text-red-500 font-bold">${msg}</p>`;
                    showToast("Erro de permissão ao salvar dados.");
                }
            },
            error: (error, file) => {
                console.error("Erro do PapaParse:", error, file);
                feedbackDiv.innerHTML = `<p class="text-red-500">Erro ao processar o ficheiro CSV: ${error.message}</p>`;
            }
        });

    } catch (error) {
        console.error("Erro ao carregar ou usar PapaParse:", error);
        feedbackDiv.innerHTML = `<p class="text-red-500">Erro crítico ao carregar a biblioteca de CSV.</p>`;
        showToast("Erro ao carregar a biblioteca de leitura de CSV.");
    }
}

/**
 * Lida com a submissão do formulário de adição/edição de aluno.
 */
async function handleStudentFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('student-id-input').value; 
    const matricula = document.getElementById('student-matricula-input').value.trim();
    const name = document.getElementById('student-name-input').value.trim();
    
    if (!matricula || !name) return showToast("Matrícula e Nome são obrigatórios.");

    const studentData = {
        matricula, name,
        class: document.getElementById('student-class-input').value.trim(),
        endereco: document.getElementById('student-endereco-input').value.trim(),
        contato: document.getElementById('student-contato-input').value.trim(),
        resp1: document.getElementById('student-resp1-input').value.trim(),
        resp2: document.getElementById('student-resp2-input').value.trim()
    };

    try {
        const collectionRef = getStudentsCollectionRef();

        if (id && id !== matricula) {
            await setDoc(doc(collectionRef, matricula), studentData);
            await deleteDoc(doc(collectionRef, id));
        } else {
            await setDoc(doc(collectionRef, matricula), studentData, { merge: true });
        }

        // Atualiza o estado local (apenas se o aluno estiver na lista visível de 10, ou adiciona no topo)
        if (id) {
            const index = state.students.findIndex(s => s.matricula === id);
            if (index > -1) state.students.splice(index, 1);
        }
        
        // Adiciona ao topo da lista local para feedback imediato
        state.students.unshift(studentData);
        // Mantém apenas 10 na lista local para não crescer infinitamente
        if (state.students.length > 10) state.students.pop();

        renderStudentsList(); 
        resetStudentForm(); 
        showToast(`Aluno ${id ? 'atualizado' : 'adicionado'} com sucesso.`);
        
    } catch(error) {
        console.error("Erro ao salvar aluno:", error);
        showToast("Erro ao salvar dados do aluno.");
    }
}

/**
 * Lida com cliques nos botões de editar e excluir na tabela de alunos.
 */
async function handleStudentTableActions(e) {
    const editBtn = e.target.closest('.edit-student-btn');
    if (editBtn) {
        const id = editBtn.dataset.id;
        // Procura na tabela renderizada atual (pode ser resultado de busca)
        // Como não temos 'currentRenderedList' global, procuramos no state.students (que pode não ter o aluno se for busca)
        // SOLUÇÃO: Busca no DOM ou tenta buscar no servidor se não achar na memória.
        
        // Melhor: Tenta achar no state.students primeiro.
        let student = state.students.find(s => s.matricula === id);
        
        // Se não achou (porque veio de uma pesquisa e não está nos 10 iniciais), 
        // precisamos dos dados. Como o botão está na tabela, os dados vieram de algum lugar.
        // Para simplificar sem complicar a arquitetura: vamos buscar no servidor individualmente.
        if (!student) {
             // Fallback: busca no Firestore (rápido, 1 doc)
             try {
                 // (CORREÇÃO) Esta chamada exige que 'getDoc' tenha sido importado
                 const docSnap = await getDoc(doc(getStudentsCollectionRef(), id));
                 if(docSnap.exists()) student = { matricula: docSnap.id, ...docSnap.data() };
             } catch(e) { console.error(e); }
        }

        if (student) {
            document.getElementById('student-form-title').textContent = 'Editar Aluno';
            document.getElementById('student-id-input').value = student.matricula; 
            document.getElementById('student-matricula-input').value = student.matricula;
            document.getElementById('student-name-input').value = student.name;
            document.getElementById('student-class-input').value = student.class || '';
            document.getElementById('student-endereco-input').value = student.endereco || '';
            document.getElementById('student-contato-input').value = student.contato || '';
            document.getElementById('student-resp1-input').value = student.resp1 || '';
            document.getElementById('student-resp2-input').value = student.resp2 || '';
            dom.cancelEditStudentBtn.classList.remove('hidden'); 
        }
        return;
    }

    const deleteBtn = e.target.closest('.delete-student-btn');
    if (deleteBtn) {
        const id = deleteBtn.dataset.id;
        // (Mesma lógica de busca do aluno para o nome)
        let studentName = "este aluno";
        const student = state.students.find(s => s.matricula === id);
        if (student) studentName = student.name;
        
        if (confirm(`Tem a certeza que quer remover ${studentName}? Esta ação não pode ser desfeita.`)) {
            try {
                await deleteDoc(doc(getStudentsCollectionRef(), id));
                state.students = state.students.filter(s => s.matricula !== id);
                renderStudentsList(); 
                showToast("Aluno removido com sucesso.");
            } catch(error) {
                console.error("Erro ao remover aluno:", error);
                showToast("Erro ao remover aluno.");
            }
        }
    }
}

/**
 * Função principal do módulo: anexa os listeners de eventos.
 */
export const initStudentListeners = () => {
    const manageStudentsBtn = document.getElementById('manage-students-btn');
    const { studentsModal, uploadCsvBtn, studentForm, cancelEditStudentBtn, studentsListTable } = dom;

    if (manageStudentsBtn && studentsModal) {
        manageStudentsBtn.addEventListener('click', () => {
            renderStudentsList(); 
            openModal(studentsModal);
        });
    }

    // (NOVO) Adiciona Listener para a Barra de Pesquisa dentro do Modal
    // Vamos injetar dinamicamente o input de pesquisa se ele não existir no HTML
    const modalHeader = studentsModal.querySelector('.bg-gray-100');
    if (modalHeader && !document.getElementById('student-modal-search')) {
        // Cria a barra de pesquisa no header do modal
        const searchContainer = document.createElement('div');
        searchContainer.className = "mt-3 w-full";
        searchContainer.innerHTML = `
            <div class="relative">
                <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <i class="fas fa-search text-gray-400"></i>
                </div>
                <input type="text" id="student-modal-search" class="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-sky-500 focus:border-sky-500 sm:text-sm" placeholder="Pesquisar aluno na base de dados...">
            </div>
        `;
        // Insere antes do botão de fechar ou no final do header
        modalHeader.appendChild(searchContainer);
        
        // Adiciona o listener
        document.getElementById('student-modal-search').addEventListener('input', handleStudentSearch);
    }


    if (uploadCsvBtn) {
        uploadCsvBtn.addEventListener('click', handleCsvUpload);
    }

    if (studentForm) {
        studentForm.addEventListener('submit', handleStudentFormSubmit);
    }

    if (cancelEditStudentBtn) {
        cancelEditStudentBtn.addEventListener('click', resetStudentForm);
    }

    if (studentsListTable) {
        studentsListTable.addEventListener('click', handleStudentTableActions);
    }
};