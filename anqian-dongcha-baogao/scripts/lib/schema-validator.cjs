const path = require("node:path");

function typeMatches(value, expectedType) {
  switch (expectedType) {
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true;
  }
}

function formatPath(instancePath, key) {
  const encodedKey = String(key).replace(/~/g, "~0").replace(/\//g, "~1");
  return `${instancePath}/${encodedKey}`;
}

function resolveReference(rootSchema, reference) {
  if (!reference.startsWith("#/")) {
    throw new Error(`不支持的 Schema 引用: ${reference}`);
  }

  return reference
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((current, part) => current?.[part], rootSchema);
}

function addError(result, instancePath, message) {
  result.errors.push({ path: instancePath || "/", message });
}

function validateNode(value, schema, rootSchema, instancePath) {
  const result = { errors: [], evaluated: new Set() };

  if (schema?.$ref) {
    const target = resolveReference(rootSchema, schema.$ref);
    if (!target) {
      addError(result, instancePath, `Schema 引用不存在: ${schema.$ref}`);
      return result;
    }
    return validateNode(value, target, rootSchema, instancePath);
  }

  if (schema?.allOf) {
    for (const branch of schema.allOf) {
      const branchResult = validateNode(value, branch, rootSchema, instancePath);
      result.errors.push(...branchResult.errors);
      for (const key of branchResult.evaluated) {
        result.evaluated.add(key);
      }
    }
  }

  if (schema?.oneOf) {
    const branchResults = schema.oneOf.map((branch) =>
      validateNode(value, branch, rootSchema, instancePath)
    );
    const passingBranches = branchResults.filter((branchResult) => branchResult.errors.length === 0);
    if (passingBranches.length !== 1) {
      addError(
        result,
        instancePath,
        `oneOf 校验失败：匹配分支数量为 ${passingBranches.length}，应为 1`
      );
    } else {
      for (const key of passingBranches[0].evaluated) {
        result.evaluated.add(key);
      }
    }
  }

  if (schema?.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeMatches(value, type))) {
      addError(result, instancePath, `类型错误：应为 ${types.join(" 或 ")}`);
      return result;
    }
  }

  if (Object.prototype.hasOwnProperty.call(schema ?? {}, "const") && !Object.is(value, schema.const)) {
    addError(result, instancePath, `值必须等于 ${JSON.stringify(schema.const)}`);
  }

  if (schema?.enum && !schema.enum.some((allowed) => Object.is(value, allowed))) {
    addError(result, instancePath, `值不在允许范围内: ${schema.enum.join(", ")}`);
  }

  if (typeof value === "string") {
    if (schema?.minLength !== undefined && value.length < schema.minLength) {
      addError(result, instancePath, `字符串长度不能小于 ${schema.minLength}`);
    }
    if (schema?.pattern && !new RegExp(schema.pattern).test(value)) {
      addError(result, instancePath, `字符串不符合格式 ${schema.pattern}`);
    }
  }

  if (typeof value === "number" && schema?.minimum !== undefined && value < schema.minimum) {
    addError(result, instancePath, `数值不能小于 ${schema.minimum}`);
  }

  if (Array.isArray(value)) {
    if (schema?.minItems !== undefined && value.length < schema.minItems) {
      addError(result, instancePath, `数组项目数不能小于 ${schema.minItems}`);
    }
    if (schema?.uniqueItems) {
      const serialized = value.map((item) => JSON.stringify(item));
      if (new Set(serialized).size !== serialized.length) {
        addError(result, instancePath, "数组项目必须唯一");
      }
    }
    if (schema?.items) {
      value.forEach((item, index) => {
        const itemResult = validateNode(item, schema.items, rootSchema, formatPath(instancePath, index));
        result.errors.push(...itemResult.errors);
      });
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema?.properties ?? {};
    const propertyNames = new Set(Object.keys(properties));

    if (schema?.required) {
      for (const requiredProperty of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(value, requiredProperty)) {
          addError(
            result,
            formatPath(instancePath, requiredProperty),
            "缺少必填字段"
          );
        }
      }
    }

    for (const [propertyName, propertySchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, propertyName)) {
        result.evaluated.add(propertyName);
        const propertyResult = validateNode(
          value[propertyName],
          propertySchema,
          rootSchema,
          formatPath(instancePath, propertyName)
        );
        result.errors.push(...propertyResult.errors);
      }
    }

    if (schema?.additionalProperties === false) {
      for (const propertyName of Object.keys(value)) {
        if (!propertyNames.has(propertyName)) {
          addError(
            result,
            formatPath(instancePath, propertyName),
            "不允许出现未声明字段"
          );
        }
      }
    }

    if (schema?.unevaluatedProperties === false) {
      for (const propertyName of Object.keys(value)) {
        if (!result.evaluated.has(propertyName)) {
          addError(
            result,
            formatPath(instancePath, propertyName),
            "不允许出现未被 Schema 分支声明的字段"
          );
        }
      }
    }
  }

  return result;
}

function validateDocument(value, schema) {
  if (!schema || typeof schema !== "object") {
    return [{ path: "/", message: "Schema 不是对象" }];
  }

  try {
    return validateNode(value, schema, schema, "").errors;
  } catch (error) {
    return [
      {
        path: "/",
        message: error instanceof Error ? error.message : String(error)
      }
    ];
  }
}

module.exports = {
  formatPath,
  validateDocument
};
