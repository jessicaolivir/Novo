# PDV: sistema de ponto de venda

Programa de computador para o caixa do comércio. Controla vendas, estoque, caixa e relatórios, e envia backup automático pelo Gmail.

## Como instalar no Windows

1. Abra a página **Releases** do repositório e entre em **PDV - Instalador para Windows**.
2. Baixe o arquivo `PDV-Instalador-x.x.x.exe`.
3. Dê dois cliques no arquivo e siga o instalador. Um atalho **PDV** é criado na área de trabalho.

O Windows pode mostrar o aviso "O Windows protegeu o computador", porque o programa não tem assinatura digital paga. Clique em **Mais informações** e depois em **Executar assim mesmo**.

O instalador é gerado automaticamente pelo GitHub Actions a cada atualização. Ele também fica disponível na aba **Actions**, no artefato `PDV-Instalador-Windows`.

## Funcionalidades

- **Vendas**: leitor de código de barras, busca por nome, grade de produtos por categoria, quantidade com `3*código`, desconto em R$ ou %.
- **Pagamento**: dinheiro com troco, débito, crédito e PIX, inclusive divididos na mesma venda.
- **Cupom não fiscal** para impressora térmica de 80 mm.
- **Produtos**: custo, preço, margem, categoria, unidade (UN, KG, L...) e movimentação de estoque.
- **Caixa**: abertura, sangria, suprimento e fechamento com conferência do dinheiro.
- **Relatórios**: faturamento, ticket médio, lucro bruto, gráfico por dia, formas de pagamento, mais vendidos e estoque baixo.
- **Tema claro e escuro**.
- **Backup**: cópia automática diária na pasta `Documentos\PDV Backups` e envio pelo Gmail.

## Backup pelo Gmail

O programa envia o backup como anexo para o Gmail da loja. Para isso o Google exige uma **senha de app**, que é diferente da senha normal:

1. Ative a **Verificação em duas etapas** na conta Google da loja.
2. Acesse https://myaccount.google.com/apppasswords, crie uma senha com o nome "PDV" e copie as 16 letras.
3. No PDV, vá em **Configurações**, preencha o Gmail e a senha de app e clique em **Salvar e enviar teste**.

O envio acontece ao fechar o caixa e uma vez por dia. A senha fica guardada criptografada pelo próprio Windows. Para restaurar, use **Configurações → Restaurar backup** e escolha o arquivo `.json` recebido por e-mail.

## Atalhos

| Tecla | Ação |
|-------|------|
| F1 | Tela de vendas |
| F2 | Campo de produto |
| F4 | Finalizar venda |
| F8 | Limpar venda em andamento |
| Alt+1 a Alt+4 | Forma de pagamento |
| F11 | Tela cheia |
| Ctrl + / Ctrl − | Aumentar ou diminuir o zoom |

## Para desenvolvedores

```bash
npm install
npm start           # abre o programa
npm run dist:win    # gera o instalador (em Windows)
```

Abrir o `index.html` diretamente no navegador também funciona, mas sem o backup pelo Gmail.

## Observação

O cupom é **não fiscal**. A emissão de NFC-e exige integração com a SEFAZ e certificado digital, o que não está incluído.
