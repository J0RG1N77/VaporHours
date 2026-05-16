# VaporHours

VaporHours é uma ferramenta desktop para aumentar o tempo de jogo em títulos da Steam já disponíveis na máquina do usuário. A proposta é simples: permitir que você aumente as horas de um jogo sem precisar mantê-lo aberto manualmente durante todo o tempo.

## Download

Para começar a usar, baixe a versão mais recente clicando no botão abaixo:

[![Baixar VaporHours](https://img.shields.io/badge/DOWNLOAD-VaporHours_v1.0.0-blue?style=for-the-badge&logo=windows)](https://github.com/J0RG1N77/VaporHours/releases/download/v1.0.0/VaporHours.Setup.1.0.0.exe)

> **Instrução:** Após baixar, execute o arquivo `VaporHours.Setup.1.0.0.exe` para instalar. O aplicativo criará automaticamente um atalho na sua Área de Trabalho.

## O que o VaporHours faz

- Exibe a biblioteca da Steam do usuário em uma interface desktop moderna.
- Permite selecionar um jogo e iniciar o acompanhamento de horas com poucos cliques.
- Oferece um fluxo direto de iniciar e parar, com feedback visual de status.

## Tecnologias utilizadas

- Electron
- Node.js
- JavaScript
- HTML5
- CSS3
- Steamworks.js
- Steam Web API

## Segurança e privacidade

O VaporHours foi pensado para rodar de forma local no computador do usuário, com foco em controle e transparência.

- O aplicativo não solicita senha da Steam.
- Não há criação de conta própria dentro do app.
- Os dados usados pela interface são obtidos e processados localmente, no computador do usuário.
- O código é aberto para auditoria, permitindo verificar exatamente como o aplicativo funciona.

Importante: para listar a biblioteca Steam, o aplicativo utiliza os dados da sessão já autenticada no computador e informações públicas necessárias para exibir os jogos. Nenhuma credencial é armazenada pelo VaporHours.

## Interface

O projeto foi desenhado com uma estética escura, moderna e objetiva, priorizando leitura rápida, seleção visual de jogos e navegação direta.

## Estrutura do projeto

- `app.js`: processo principal do Electron.
- `preload.js`: ponte segura entre o processo principal e o renderer.
- `public/index.html`: layout da interface.
- `public/renderer.js`: lógica da tela.
- `public/style.css`: estilos da aplicação.
- `build/icons/`: ícones do aplicativo.

## Observações

- O projeto depende de uma sessão Steam já aberta na máquina do usuário.
- A experiência pode variar de acordo com a conta, a biblioteca disponível e o estado da sessão Steam local.
