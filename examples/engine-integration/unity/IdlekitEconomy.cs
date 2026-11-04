// ScriptableObject that holds `idk export engine --target unity` output.
// Field names match the exported JSON so JsonUtility can fill them directly.
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Idlekit
{
    [Serializable]
    public class IdlekitParameter
    {
        public string key;
        public string type;
        public string role;
        /// <summary>Exact value as text. Amounts can exceed double range.</summary>
        public string text;
        public double value;
    }

    [Serializable]
    public class IdlekitCurve
    {
        public string id;
        public string kind;
        public string variable;
        public string baseText;
        public double @base;
        public double growth;
        public string perUnitText;
        public double perUnit;
        public string formula;
    }

    [Serializable]
    public class IdlekitLevel
    {
        public int level;
        public double cost;
        public string costText;
        public double totalCost;
        public double incomePerSec;
    }

    [CreateAssetMenu(fileName = "IdlekitEconomy", menuName = "idlekit/Economy")]
    public class IdlekitEconomy : ScriptableObject
    {
        public int formatVersion = 1;
        public string scenarioId;
        public string title;
        public string scenarioHash;
        public string unitCode;
        public string unitSymbol;
        public string modelId;
        public int modelVersion = 1;
        public double stepSec = 1;
        public double durationSec;
        public double initialWallet;
        public string initialWalletText;
        public double prestigeMultiplier = 1;
        public List<IdlekitParameter> parameters = new List<IdlekitParameter>();
        public List<IdlekitCurve> curves = new List<IdlekitCurve>();
        public string levelVariable;
        public List<IdlekitLevel> levels = new List<IdlekitLevel>();

        public double Parameter(string key, double fallback = 0)
        {
            var found = parameters.Find(p => p.key == key);
            return found != null ? found.value : fallback;
        }

        public IdlekitCurve Curve(string id) => curves.Find(c => c.id == id);

        /// <summary>Price of the next unit when <paramref name="owned"/> units are owned.</summary>
        public double CostAt(int owned)
        {
            if (owned >= 0 && owned < levels.Count) return levels[owned].cost;
            var curve = Curve("buy.generator.cost");
            return curve == null ? double.PositiveInfinity : curve.@base * Math.Pow(curve.growth, owned);
        }

        /// <summary>Income per second when <paramref name="owned"/> units are owned.</summary>
        public double IncomeAt(int owned, double multiplier = 1)
        {
            if (owned >= 0 && owned < levels.Count) return levels[owned].incomePerSec * multiplier;
            var curve = Curve("income");
            return curve == null ? 0 : (curve.@base + curve.perUnit * owned) * multiplier;
        }

        /// <summary>Overwrite this asset from exported JSON text.</summary>
        public void LoadJson(string json) => JsonUtility.FromJsonOverwrite(json, this);
    }
}
