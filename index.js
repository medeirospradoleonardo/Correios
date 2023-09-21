const axios = require('axios')
const convert = require("xml-js");

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

const codigos = ['LB579818367HK', 'LB579934685HK', 'LB579752952HK', 'LB579944793HK', 'NL872055306BR']

const index = async () => {
  rastreios = await Promise.all(codigos.map(async (codigo) => (
    await request(`https://www.cepcerto.com/ws/encomenda/${codigo}/`, {
      method: 'GET',
      headers: {
        'content-type': 'text/xml',
        'user-agent': 'Dart/2.18 (dart:io)',
      }
    }).then((body) => {
      const data = JSON.parse(
        convert.xml2json(body.data, { compact: true, spaces: 2 })
      );

      if (data.xml.row?.Erro?._text) {
        return (
          {
            "eventos": null
          }
        )
      } else {

        return (
          {
            "eventos": data.xml.row.map((evento) => {
              return {
                "descricao": getStringFiltered(evento.descricao._text),
                "unidade": evento.cidade._text ? {
                  "endereco": {
                    "cidade": getStringFiltered(evento.cidade._text),
                    "uf": getStringFiltered(evento.uf._text)
                  }
                } : null
              }
            })
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