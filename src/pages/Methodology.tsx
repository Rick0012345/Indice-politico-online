import React from 'react';
import {CheckCircle2, Info} from 'lucide-react';
import {Link} from 'react-router-dom';

const secoes = [
  {id: 'fontes', label: 'Fontes de dados'},
  {id: 'indicadores', label: 'Como calculamos'},
  {id: 'avaliacao', label: 'Sistema de avaliação'},
  {id: 'judicial', label: 'Histórico judicial'},
  {id: 'integridade', label: 'Integridade e segurança'},
];

const indicadores = [
  {
    nome: 'Nota popular',
    formula: 'média das avaliações (1 a 5)',
    detalhe: 'Uma avaliação por CPF e político; a mais recente substitui a anterior.',
  },
  {
    nome: 'Participação em votações',
    formula: 'votos registrados / votações nominais no período do parlamentar',
    detalhe: 'O período vai do primeiro ao último voto registrado do parlamentar na base. Não mede presença em sessões sem votação nominal.',
  },
  {
    nome: 'Alinhamento com o governo',
    formula: 'votos iguais à orientação do governo / votos em votações com orientação Sim ou Não',
    detalhe: 'Orientações "liberado" ou "obstrução" e votos de abstenção não entram na conta.',
  },
  {
    nome: 'Despesas vs média',
    formula: '(despesas do parlamentar - média da Câmara) / média da Câmara',
    detalhe: 'A média usa o mesmo período e o mesmo status (na ativa, fora da ativa ou todos). A cota varia por estado.',
  },
  {
    nome: 'Concordância entre dois parlamentares',
    formula: 'votações com o mesmo voto / votações nominais em que ambos votaram',
    detalhe: 'Subvotações (destaques) ficam de fora.',
  },
];

const integridade = [
  {titulo: 'Limite de identidade:', texto: 'Informar um CPF válido não comprova que ele pertence à pessoa que avalia.'},
  {
    titulo: 'Tratamento do CPF:',
    texto: 'O CPF digitado é convertido em hash e não é exibido publicamente. O hash permite reconhecer avaliações repetidas para o mesmo político.',
  },
  {titulo: 'Auditoria:', texto: 'Nosso código de processamento de dados é aberto para auditoria de especialistas em tecnologia cívica.'},
];

export const Methodology = () => {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-12 px-4 pb-24 pt-14 sm:px-6 lg:flex-row lg:px-8">
      <nav aria-label="Nesta página" className="lg:w-56 lg:shrink-0">
        <div className="lg:sticky lg:top-24">
          <p className="mb-2 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">Nesta página</p>
          <ul className="flex flex-wrap gap-1 lg:flex-col">
            {secoes.map((secao) => (
              <li key={secao.id}>
                <a href={`#${secao.id}`} className="block rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-50">
                  {secao.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <article className="min-w-0 flex-1 space-y-14">
        <header>
          <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl dark:text-slate-50">Nossa metodologia</h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600 dark:text-slate-400">
            Transparência não é apenas sobre dados, é sobre como eles são processados e apresentados.
          </p>
        </header>

        <section id="fontes" className="scroll-mt-24">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Fontes de dados</h2>
          <p className="mt-3 max-w-[68ch] text-base leading-7 text-slate-700 dark:text-slate-300">
            A fonte implementada para os registros parlamentares é a API de Dados Abertos da{' '}
            <a href="https://dadosabertos.camara.leg.br/" target="_blank" rel="noreferrer" className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
              Câmara dos Deputados
            </a>
            . Cada registro exibido aponta para o original sempre que a API oferece o link.
          </p>
        </section>

        <section id="indicadores" className="scroll-mt-24">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Como calculamos cada indicador</h2>
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
            {indicadores.map((indicador) => (
              <div key={indicador.nome} className="surface p-5">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">{indicador.nome}</h3>
                <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 font-mono text-[13px] leading-6 text-brand-900 dark:bg-brand-950 dark:text-brand-100">{indicador.formula}</p>
                <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">{indicador.detalhe}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="avaliacao" className="scroll-mt-24 space-y-5">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Sistema de avaliação</h2>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Voto popular (1 a 5 estrelas)</h3>
            <p className="mt-2 max-w-[68ch] leading-7 text-slate-700 dark:text-slate-300">
              A nota principal exibida no perfil é a média das avaliações registradas. O CPF digitado é convertido em hash para limitar duplicatas por político; uma nova avaliação com o mesmo CPF substitui a anterior. Esse mecanismo não autentica a identidade da pessoa e não utiliza login Gov.br.
            </p>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Ponderação de atividade</h3>
            <p className="mt-2 max-w-[68ch] leading-7 text-slate-700 dark:text-slate-300">
              Embora a nota seja popular, exibimos métricas objetivas como participação em votações e alinhamento com o governo para fornecer contexto à avaliação do cidadão.
            </p>
          </div>
        </section>

        <section id="judicial" className="scroll-mt-24 space-y-4 text-slate-700 dark:text-slate-300">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Histórico judicial e condenações</h2>
          <p className="max-w-[68ch] leading-7">O ranking ordena a quantidade de casos com condenação definitiva, com trânsito em julgado informado. Criminal é a categoria inicial; improbidade administrativa, eleitoral e contas públicas possuem contagens separadas. Um mesmo processo normalizado por pessoa e categoria conta uma vez. Condenações sujeitas a recurso são apresentadas separadamente; anuladas e revertidas permanecem no histórico e ficam fora da contagem de definitivas. Avaliações populares não influenciam essa ordenação.</p>
          <p className="max-w-[68ch] leading-7">O histórico de prisões registra somente cumprimento efetivo confirmado, com modalidade, motivo ou fundamento, data, eventual soltura, desfecho e fonte oficial. Mandado pendente não comprova prisão. Prisão não equivale a condenação definitiva, não acrescenta pontos e pode ser usada como filtro. Soltura, por si só, não significa absolvição.</p>
          <p className="max-w-[68ch] leading-7">Publicamos somente registros revisados com fonte oficial e confirmação de identidade. Notícias e coincidências de nome não bastam. Cada perfil apresenta o escopo da pesquisa, fontes e data de revisão. Não há promessa de cobertura nacional completa: zero significa nenhum registro no escopo pesquisado; ausência de pesquisa aparece como não pesquisado, ao final da ordenação nas duas direções. Falhas de consulta são informadas como erro.</p>
          <Link to="/ranking?view=judicial" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 underline dark:text-brand-300">Consultar ranking de condenações</Link>
        </section>

        <section id="integridade" className="scroll-mt-24 rounded-2xl bg-slate-900 p-6 text-slate-200 sm:p-8 dark:bg-slate-800">
          <h2 className="text-2xl font-semibold text-white">Integridade e segurança</h2>
          <ul className="mt-5 space-y-4">
            {integridade.map((item) => (
              <li key={item.titulo} className="flex gap-3">
                <CheckCircle2 size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-300" />
                <p className="leading-7">
                  <strong className="text-white">{item.titulo}</strong> {item.texto}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <div className="surface flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <Info size={22} aria-hidden="true" className="shrink-0 text-brand-600 dark:text-brand-400" />
          <p className="flex-1 text-sm leading-6 text-slate-700 dark:text-slate-300">
            Tem alguma dúvida sobre como os dados são calculados? Entre em contato com nossa equipe técnica através do canal de transparência.
          </p>
          <Link to="/sobre" className="shrink-0 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">
            Sobre o projeto
          </Link>
        </div>
      </article>
    </div>
  );
};
