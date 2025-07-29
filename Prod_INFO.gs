// Листинг кода для расширения GOOGLE SHEETS по извлечению актуальной информации по собственным 
// и конкурентным ценам из API Seller OZON

// В начале скрипта (после объявления констант, если они есть)
var props = PropertiesService.getScriptProperties();

const ss = SpreadsheetApp.getActiveSpreadsheet();
const limit = 1000;

// Функция для получения списка SKU
function skuList(s, e) {
  try {
    const valuesFrom = ss.getSheetByName('Product List');
    
    if (!valuesFrom) {
      throw new Error("Лист 'Product List' не найден");
    }
    
    if (valuesFrom.getLastRow() < 2) {
      throw new Error("Лист 'Product List' не содержит данных");
    }
    
    // Получаем значения колонки "Offer ID" (колонка A)
    const values = valuesFrom.getRange(2, 1, valuesFrom.getLastRow() - 1, 1).getValues();
    const filteredValues = values.filter(elem => elem[0] !== "");
    
    if (filteredValues.length === 0) {
      throw new Error("Нет данных в колонке Offer ID");
    }
    
    const res = filteredValues.slice(s || 0, e || limit).map(elem => String(elem[0]));
    Logger.log("Передаем массив offer_id длиной: " + res.length);
    return res;
    
  } catch (error) {
    Logger.log("Ошибка в функции skuList: " + error.message);
    SpreadsheetApp.getUi().alert("Ошибка: " + error.message);
    return [];
  }
}

// Основная функция для получения информации о товарах
function callRequestProductlist(i, st, end) {
  try {
    const strt = st || 0;
    const endd = end || limit;
    let sheetTo = ss.getSheetByName('product info');
    
    // Создаем лист, если он не существует
    if (!sheetTo) {
      sheetTo = ss.insertSheet('product info');
    }
    
    // Заголовки таблицы
    const headers = [
      "№", "Offer ID", "SKU", "Product ID", "Штрихкоды", 
      "Название", "Старая цена", "Цена", "Маркетинговая цена (по акции!)", 
      "Мин. цена конкурентов", "Мин. цена (др. продавцов Ozon)"
    ];
    
    // Записываем и форматируем заголовки
    sheetTo.getRange("A1:K1")
      .setValues([headers])
      .setBackground("#f0f0f0")
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setWrap(true);
    
    // Замораживаем строку с заголовками
    sheetTo.setFrozenRows(1);
    
    let iteration = i || 1;

    // Очищаем старые данные только при первой итерации
    if (iteration === 1 && sheetTo.getLastRow() > 1) {
      sheetTo.getRange(2, 1, sheetTo.getLastRow() - 1, sheetTo.getLastColumn()).clearContent();
    }

    const skus = skuList(strt, endd);
    
    if (skus.length === 0) {
      ss.toast('Нет Offer ID для запроса', 'Предупреждение');
      return;
    }

    // Формируем запрос к API Ozon
    const body = {
      "offer_id": skus,
      "limit": limit
    };

    const response = UrlFetchApp.fetch("https://api-seller.ozon.ru/v3/product/info/list", optionsRequest(body));
    const json = response.getContentText();
    const data = JSON.parse(json);
    
    Logger.log("Получено товаров: " + (data?.items?.length || 0));
    const result = data.items || [];

    if (!result.length) {
      ss.toast('Нет данных для выбранных Offer ID', 'Информация');
      return;
    }

    // Формируем массив данных для записи
    const productData = result.map(elem => [
      iteration++,
      elem.offer_id || '',
      elem.sources?.[0]?.sku || null,
      String(elem.id || ''),
      Array.isArray(elem.barcodes) ? elem.barcodes.join(', ') : '',
      elem.name || '',
      parseFloat(elem.old_price || 0).toFixed(0),
      parseFloat(elem.price || 0).toFixed(0),
      parseFloat(elem.marketing_price || 0).toFixed(0),
      parseFloat(elem.price_indexes?.external_index_data?.minimal_price || 0).toFixed(0),
      parseFloat(elem.price_indexes?.ozon_index_data?.minimal_price || 0).toFixed(0)
    ]);

    // Определяем строку для вставки данных ПЕРЕД использованием
    const startRow = sheetTo.getLastRow() > 1 ? sheetTo.getLastRow() + 1 : 2;

    // Записываем данные
    const dataRange = sheetTo.getRange(startRow, 1, productData.length, productData[0].length);
    dataRange.setValues(productData);

    // Форматирование данных:
    // 1. Все колонки по умолчанию выравниваем по левому краю
    dataRange
      .setVerticalAlignment("middle")
      .setHorizontalAlignment("left");

    // 2. Колонки с цифрами (цены) выравниваем по правому краю
    const priceColumns = [7, 8, 9, 10, 11]; // Номера колонок G, H, I, J, K (начиная с 1)
    priceColumns.forEach(col => {
      sheetTo.getRange(startRow, col, productData.length, 1)
        .setHorizontalAlignment("right")
        .setNumberFormat("#,##0"); // Формат с разделителями тысяч
    });

    // 3. Колонки с ID и названиями выравниваем по левому краю
    const textColumns = [2, 3, 4, 5, 6]; // Колонки B, C, D, E, F
    textColumns.forEach(col => {
      sheetTo.getRange(startRow, col, productData.length, 1)
        .setHorizontalAlignment("left");
    });

    // 4. Нумерация (колонка A) - по центру
    sheetTo.getRange(startRow, 1, productData.length, 1)
      .setHorizontalAlignment("center");

    // Автоподбор ширины столбцов
    sheetTo.autoResizeColumns(1, productData[0].length);

    // Затем ограничение максимальной ширины для колонки F
const currentWidth = sheetTo.getColumnWidth(6);
if (currentWidth > 250) { // Если ширина больше 250px
  sheetTo.setColumnWidth(6, 450); // Устанавливаем 450px
}
    
    // Проверяем, нужно ли продолжать запросы (пагинация)
    if (skus.length === limit) {
      Utilities.sleep(500); // Задержка между запросами
      callRequestProductlist(iteration, strt + limit, endd + limit);
    } else {
      ss.toast('Данные успешно загружены', 'Успешно');
    }
    
  } catch (error) {
    Logger.log("Ошибка: " + error.message);
    SpreadsheetApp.getUi().alert("Ошибка выполнения: " + error.message);
  }
}


// Вспомогательная функция для API запросов
function optionsRequest(body) {
  return {
    "method": "POST",
    "headers": {
      "Client-Id": props.getProperty('OZON_CLIENT_ID'),
      "Api-Key": props.getProperty('OZON_API_KEY'),
      "Content-Type": "application/json"
    },
    "payload": JSON.stringify(body),
    "muteHttpExceptions": true
  };

}
