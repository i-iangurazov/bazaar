# Возврат выпуска playground — 29 октября 2026

Вся playground выпускается **одним PR с обычным merge-коммитом**. Проверенное
основание main — `5a27b8e37f03df2d73603fe37e4975d44888ddf5`. Возврат проверен на
одноразовой базе с настоящими production-сборками обеих версий. Production и
постоянный локальный Bazaar на 3122 при репетиции не менялись.

## Что отменяем и что сохраняем

Возвращаем прикладной код, интерфейс и зависимости к прежнему main. Сохраняем
пять применённых миграций подписок/Studio/прайсов, их строгие SHA256-проверки в
`scripts/deployment/migrations.ts` и `.gitignore` для частных локальных данных.
Остальные tracked-файлы кандидата побайтово совпадают с прежним main.

Новые таблицы и колонки остаются. **Продажи, платежи, перемещения и изменения
цен после релиза сохраняются.** Возврат версии приложения не отменяет хозяйственные
операции. Простой GitHub Revert всего PR без сохранения миграций блокирует
production-сборку старым guard. Guard не ослабляется, журнал Prisma не правится,
таблицы не удаляются. Восстановление старого бэкапа поверх рабочей базы потеряло
бы новые операции и не является штатным способом такого отката.

## Проверка

На новой БД выполнены обновление, общий прайс, оплаченный кассовый чек, дробное
перемещение, проверки прав, сборка и запуск старой версии, повтор операций без
двойной записи, ещё одна продажа/индивидуальная цена в старой версии и возврат
к новой. Старый runtime сохранил все **137 таблиц** при запуске/чтении; бэкап
после новых операций восстановился в другую пустую БД с теми же хэшами.

Новые таблицы содержали непустые прайсы/журнал и синтетические записи подписки,
периода, события и Studio с `highQuality=false`. Подписка — тестовая фикстура,
не настоящий платёж и не вызов провайдера. Обе production-версии через HTTPS
открыли панель, товары, историю кассы, перемещения и мобильные товары без page errors.

Подготовщик отдельно проверен на синтетическом двухродительском merge-коммите:
бинарный патч воспроизвёл точное дерево кандидата, HEAD/index/refs не менялись.
Результаты: [машинный протокол](deployment-rollback-verification-20261029.json).

## Перед выпуском

1. Проверить свежий origin/main. При изменении основания повторить репетицию;
   подготовщик при другом основании останавливается.
2. Открыть **один PR всей playground → main**, дождаться обязательных проверок
   точного PR и выбрать **Create a merge commit**, без rebase/squash.
3. Непосредственно перед выпуском записать текущий production deployment ID/URL
   в Vercel и проверить доступность Instant Rollback. Read-only GitHub-метаданные
   на 29 октября показывают успешный Production deployment `7305413460` для
   проверенного SHA `5a27b8e`. Это не заменяет актуальную проверку Vercel.
4. Создать production-бэкап штатными средствами провайдера и проверить его
   восстановимость отдельно. Локальный синтетический бэкап его не заменяет;
   production-бэкап в этой задаче не создавался.
5. Сохранить SHA merge-коммита и оба deployment ID. После выпуска проверить
   health, вход, чтение товаров/остатков/чека, логи и очереди. Не создавать
   фиктивных транзакций в клиентской базе ради smoke-теста.

## Авария: быстро вернуть пользователей

В Vercel выбрать **Instant Rollback** на записанный предыдущий production-деплой.
Домены переключаются на готовую старую версию без пересборки; база остаётся
текущей. Совместимость старого кода с новой схемой проверена локально;
реальный production-трафик при репетиции не переключался.

Проверить health, вход, чтение чеков/остатков, ошибки и очереди. Не удалять
таблицы и не восстанавливать старую базу. После rollback Vercel отключает
автоматическое назначение production-доменов новым сборкам: последующее
Promote согласовать отдельно, Git-деплой сам по себе не считать опубликованным.

## Один обратный PR для Git

Использовать **отдельный чистый checkout**, не работающую локальную playground.
HEAD должен быть ровно merge-коммитом выпуска. При более поздних коммитах
нужна отдельная проверка их сохранения и конфликтов. Переменная ниже — настоящий
SHA выпуска, а не синтетический SHA из репетиции. Команды не выполнялись против main.

```sh
git fetch origin main
git switch -c codex/rollback-playground origin/main
test "$(git rev-parse HEAD)" = "$BAZAAR_RELEASE_MERGE_SHA"
mkdir -p artifacts/deployment-rollback
node --import tsx scripts/deployment/prepare-rollback.ts \
  --merge "$BAZAAR_RELEASE_MERGE_SHA" \
  --output artifacts/deployment-rollback/emergency
git apply --check artifacts/deployment-rollback/emergency/rollback.patch
git apply --index artifacts/deployment-rollback/emergency/rollback.patch
git diff --cached --stat
git commit -m "Revert playground application; retain applied migrations and business data"
git push -u origin codex/rollback-playground
gh pr create --base main --head codex/rollback-playground \
  --title "Return Bazaar to the previous application version" \
  --body-file artifacts/deployment-rollback/emergency/PULL_REQUEST.md
```

До `git apply` проверить manifest: SHA основания/выпуска, семь сохраняемых файлов
и хэш патча. Подготовщик не подключается к БД, не меняет HEAD/index/refs и ничего
не пушит. Он отказывает при изменённой SQL, неизвестной миграции, ослабленном
guard, неподходящем merge и существующем каталоге результата. `git apply --index`
переносит только проверенный патч; не использовать `git add -A` для артефактов.

Обратный PR проходит проверки и применяется после явного решения владельца.
Для возвращения улучшений после устранения жалоб нужно отменить обратный PR
либо подготовить новый выпуск: повторное слияние исходной ветки после merge/revert
само по себе не вернёт отменённые изменения.

## Повторить локально

Нужны PostgreSQL 16 на `127.0.0.1:55448` с отдельным data_directory под
`/private/tmp/bazaar-catalog-20261029.*`, Redis `56398`, Node/pnpm, OpenSSL и
Chrome для Playwright. Зависимости кандидата устанавливаются отдельно по старому
lockfile; его Prisma Client не связывается с клиентом работающей playground.

```sh
mkdir -p artifacts/deployment-rollback
node --import tsx scripts/deployment/prepare-rollback.ts \
  --base 5a27b8e37f03df2d73603fe37e4975d44888ddf5 --release HEAD \
  --output artifacts/deployment-rollback/new-rehearsal
cd artifacts/deployment-rollback/new-rehearsal/candidate
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec prisma generate
cd ../../../..
node --import tsx scripts/deployment/rehearse-rollback.ts \
  --package artifacts/deployment-rollback/new-rehearsal
```

Каждый запуск создаёт новые БД `bazaar_hardening_rollback_*`, проверяет directory,
не делает reset/truncate и не наследует внешние БД/ключи провайдеров. Порты
3124/3127 используются только тестом; 3122/55440/56391 не затрагиваются.
Тестовый TLS-сертификат создаётся в своём каталоге; исключение проверки
сертификата ограничено двумя тестовыми localhost-портами.

Это проверка совместимости и восстановления на синтетических данных, не
нагрузочный SLA и не новая приёмка живых AI/платежей/оборудования. Для отмены
бизнес-значений нужны отдельные проверяемые корректирующие операции по журналу.

Основания: [GitHub Revert PR](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/reverting-a-pull-request),
[merge methods](https://docs.github.com/en/pull-requests/reference/pull-request-merges),
[Vercel Instant Rollback](https://vercel.com/docs/instant-rollback).
