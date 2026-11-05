// Editor menu that turns an exported JSON file into an IdlekitEconomy asset.
// Place this file in an `Editor` folder.
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Idlekit.Editor
{
    public static class IdlekitEconomyImporter
    {
        [MenuItem("Assets/idlekit/Import Economy JSON")]
        public static void ImportSelected()
        {
            var source = EditorUtility.OpenFilePanel("idlekit economy JSON", Application.dataPath, "json");
            if (string.IsNullOrEmpty(source)) return;
            var asset = ScriptableObject.CreateInstance<IdlekitEconomy>();
            asset.LoadJson(File.ReadAllText(source));
            var name = string.IsNullOrEmpty(asset.scenarioId) ? "IdlekitEconomy" : asset.scenarioId;
            var target = AssetDatabase.GenerateUniqueAssetPath($"Assets/{name}.asset");
            AssetDatabase.CreateAsset(asset, target);
            AssetDatabase.SaveAssets();
            Selection.activeObject = asset;
            Debug.Log($"idlekit: imported {asset.scenarioId} ({asset.modelId}@{asset.modelVersion}), {asset.levels.Count} levels -> {target}");
        }
    }
}
