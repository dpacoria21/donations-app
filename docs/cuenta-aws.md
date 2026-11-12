# Fase 0 — Configuración de la cuenta AWS y de GitHub

Guía paso a paso de las tareas de la fase 0 que **hace una persona del equipo** desde la
consola o su terminal (design.md §7 y §10). Los asistentes de IA no ejecutan estos pasos sobre
la cuenta. Las capturas, sin identificadores sensibles, se guardan en `evidence/fase-0/`.

Todos los comandos son de **solo lectura**, salvo los marcados como _escritura_.

## 1. Sesión con credenciales temporales (CA-NF03.3)

```bash
aws login --region us-east-2 --profile donations-dev
aws sts get-caller-identity --profile donations-dev
```

`get-caller-identity` debe mostrar tu usuario o rol, **nunca** `root`. No se crean llaves de
acceso de larga duración ni se copian a `.env`.

## 2. Región (CA-NF09.1)

En **AWS Settings → View all projects → Overview → Additional Info → Region** debe figurar
`us-east-2`. Todos los recursos regionales del proyecto se crean allí.

## 3. Plan de la cuenta y servicios (CA-NF09.1)

```bash
aws freetier get-account-plan-state --profile donations-dev --region us-east-2
```

- `FREE`: el consumo se descuenta de los créditos y no hay cargos.
- `PAID`: configurar un _spend limit_ en **AWS Settings → Billing** antes de desplegar.

Comprobar en la [lista oficial](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html)
que estén Lambda, API Gateway, DynamoDB, Cognito, S3, CloudFront, CloudWatch,
CloudFormation/SAM, IAM, CloudTrail, Budgets y Verified Permissions.

## 4. Acceso del equipo (CA-NF03.3, decisión D3)

- MFA activo en el usuario root, y el root no se usa para trabajar.
- Cada integrante con su propia identidad y MFA. Si la cuenta usa la nueva experiencia de AWS,
  se invitan como _team members_ desde **AWS Settings**; acordar con el docente cómo se acredita
  (D3).
- Ninguna llave de acceso de larga duración: **IAM → Users → Security credentials** debe
  mostrar «No access keys» en cada usuario.

## 5. Alerta de presupuesto (CA-NF09.1) — _escritura_

**Billing and Cost Management → Budgets → Create budget**:

1. Plantilla **Monthly cost budget**, importe 5 USD.
2. Destinatarios: el correo del equipo.
3. En las opciones avanzadas, comprobar que los **créditos no se resten** del costo; si se
   restan, el gasto se ve siempre en 0 y la alerta nunca salta.

Budgets es gratuito para las primeras alertas.

## 6. Herramientas locales

AWS SAM CLI (necesaria desde la fase 2 para `sam build`, `sam validate` y `sam deploy`):

```bash
winget install --id Amazon.SAM-CLI -e
```

```bash
sam --version
```

Opcional, para validar la plantilla antes de desplegar:

```bash
pip install --user cfn-lint
```

## 7. Inventario de recursos previos

La cuenta ya tuvo una demo en Java. Antes de desplegar la pila nueva, listar lo que exista para
no confundir recursos ni pagar por algo olvidado:

```bash
aws cloudformation list-stacks --region us-east-2 --profile donations-dev --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --query "StackSummaries[].StackName"
```

```bash
aws cognito-idp list-user-pools --max-results 20 --region us-east-2 --profile donations-dev --query "UserPools[].[Id,Name]"
```

```bash
aws lambda list-functions --region us-east-2 --profile donations-dev --query "Functions[].FunctionName"
```

```bash
aws dynamodb list-tables --region us-east-2 --profile donations-dev
```

```bash
aws s3 ls --profile donations-dev
```

```bash
aws cloudfront list-distributions --profile donations-dev --query "DistributionList.Items[].[Id,DomainName,Comment]"
```

Recursos que **cobran solo por existir** (deberían salir vacíos):

```bash
aws ec2 describe-instances --region us-east-2 --profile donations-dev --query "Reservations[].Instances[].[InstanceId,State.Name]"
```

```bash
aws ec2 describe-nat-gateways --region us-east-2 --profile donations-dev --query "NatGateways[].[NatGatewayId,State]"
```

```bash
aws ec2 describe-addresses --region us-east-2 --profile donations-dev --query "Addresses[].PublicIp"
```

Anotar en `tasks.md` lo encontrado. El user pool de la demo Java (`us-east-2_yAC3TdllN`) no
sirve para este diseño y se borra cuando el pool nuevo funcione (fase 8).

## 8. GitHub (design.md §6.2 y §8) — _escritura_

En **Settings** del repositorio:

1. **Rules → Rulesets → New branch ruleset** para `main`: _Restrict deletions_, _Block force
   pushes_, _Require a pull request before merging_ (1 aprobación, descartar aprobaciones al
   hacer push) y _Require status checks to pass_ con `check (backend)` y `check (frontend)`.
2. **Advanced Security:** activar _Secret scanning_ y _Push protection_.
3. **Advanced Security:** activar _Dependabot alerts_ y _Dependabot security updates_. Las
   actualizaciones de versión ya están en `.github/dependabot.yml`.

## 9. Lista de cierre de la fase 0

- [ ] Captura de `get-caller-identity` sin `root` y de la Región `us-east-2`.
- [ ] Resultado de `get-account-plan-state`.
- [ ] Captura del presupuesto creado.
- [ ] `sam --version` funciona.
- [ ] Inventario de recursos previos anotado.
- [ ] Ruleset de `main`, secret scanning y Dependabot activos.
