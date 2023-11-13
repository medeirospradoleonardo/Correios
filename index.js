const axios = require('axios')

async function request(url, options) {
  return new Promise((resolve, reject) => {
    axios({ ...options, url: url })
      .then(response => {
        return resolve(response);
      })
      .catch(error => {
        reject(error);
      });
  });
}

const getStringFiltered = (s) => {
  return s.replace(/(\r\n|\n|\r)/gm, "").trim()
}

let rastreios = []

const codigos = ['LB581600726HK', 'NL991230875BR']

const index = async () => {
  rastreios = await Promise.all(codigos.map(async (codigo) => (
    await request(`https://www.websro.com.br/rastreamento-correios.php?P_COD_UNI=${codigo}`, {
      method: 'GET',
      headers: {
        'content-type': 'text/xml',
        'user-agent': 'Dart/2.18 (dart:io)',
      }
    }).then(async (body) => {

      if (body.data.split('<li>Status: <b>').length > 1) {
        let status = body.data.split('<li>Status: <b>')[1].split('</b></li>')[0]
        switch (status) {
          case 'Objeto em trânsito - por favor aguarde':
            const origem = body.data.split('<li>Origem: ')[1].split('</li>')[0]
              .replace('Unidade de Tratamento - ', '')
              .replace('Unidade de Distribuição - ', '')
              .replace('Agência dos Correios - ', '')
              .replace(/( )+/g, ' ').replace(' / ', '-').toUpperCase()

            const destino = body.data.split('<li>Destino: ')[1].split('</li>')[0]
              .replace('Unidade de Tratamento - ', '')
              .replace('Unidade de Distribuição - ', '')
              .replace('Agência dos Correios - ', '')
              .replace(/( )+/g, ' ').replace(' / ', '-').toUpperCase()

            status = `De ${origem} para ${destino}`
            break;
          case 'Fiscalização aduaneira concluída - aguardando pagamento':
            status = 'Aguardando Pagamento'
            break
          default:
            break;
        }
        return (
          {
            "eventos": [
              {
                "descricao": status
              }
            ]

          }
        )
      } else {
        return (
          {
            "eventos": null
          }
        )
      }
    }).catch(() => {
      return (
        {
          "eventos": null
        }
      )
    })
  )))

  console.log(rastreios[0].eventos[0])
  console.log(rastreios[1].eventos[0])
}

index()