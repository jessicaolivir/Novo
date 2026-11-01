# Sistema PDV

Ponto de venda web, sem dependências e sem servidor. Basta abrir o arquivo `index.html` no navegador.
Os dados ficam salvos no próprio navegador (localStorage); use **Configurações → Exportar backup** periodicamente.

## Funcionalidades

- **Vendas**: leitura de código de barras ou busca por nome, quantidade com `3*código`, edição de quantidade, desconto em R$ ou %.
- **Pagamento**: dinheiro (com troco), débito, crédito e PIX, inclusive pagamento dividido entre várias formas.
- **Cupom não fiscal** para impressora térmica de 80 mm.
- **Produtos**: cadastro, categorias, preço de custo e venda, unidade (UN, KG, L...), entrada, saída e ajuste de estoque.
- **Caixa**: abertura com fundo de troco, sangria, suprimento, fechamento com conferência e histórico com diferenças.
- **Relatórios**: faturamento, ticket médio, lucro bruto estimado, totais por forma de pagamento, produtos mais vendidos, estoque baixo e cancelamento de vendas com estorno ao estoque.
- **Backup**: exportação e importação em JSON.

## Atalhos

| Tecla | Ação |
|-------|------|
| F1 | Tela de vendas |
| F2 | Focar no campo de produto |
| F4 | Finalizar venda |
| F8 | Cancelar venda em andamento |
| Esc | Fechar janela |

## Observação

O cupom emitido é **não fiscal**. A emissão de NFC-e exige integração com a SEFAZ e certificado digital, o que não está incluído.
